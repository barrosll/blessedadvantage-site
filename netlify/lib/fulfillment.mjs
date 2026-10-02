// Fluxo depois do pagamento: criar o envio na Sendcloud, aplicar tracking e enviar emails.
// Usado pelo webhook da Stripe, pelo webhook da Sendcloud e pela gestão.
import { loadCatalog } from "./catalog.mjs";
import { getOrder, updateOrder, applyStatus } from "./orders.mjs";
import * as sendcloud from "./sendcloud.mjs";
import { sendEmail } from "./mailer.mjs";
import {
  orderConfirmationEmail, orderShippedEmail, orderPickupEmail, orderDeliveredEmail, adminNewOrderEmail
} from "./emails.mjs";

export const siteUrlFrom = (req) => Netlify.env.get("URL") || new URL(req.url).origin;

// ---------------------------------------------------------------------------------------------
// Envio Sendcloud (idempotente)
// ---------------------------------------------------------------------------------------------
export const hasShipment = (o) => Boolean(o.sendcloudParcelId || o.sendcloudShipmentId);

/**
 * Cria o envio se ainda não existir. Nunca cria um segundo envio:
 *  - se a encomenda já tem envio, não faz nada;
 *  - a Sendcloud recebe o número da encomenda como external_reference_id — se um pedido anterior
 *    chegou à Sendcloud mas não foi gravado aqui, ela devolve o envio existente (409) e é reaproveitado.
 * Se a Sendcloud falhar, a encomenda continua paga e fica com shippingStatus = "shipping_error".
 */
export async function ensureShipment(token) {
  const order = await getOrder(token);
  if (!order) throw new Error("Encomenda não encontrada");
  if (hasShipment(order)) return { order, skipped: "já existe envio" };
  if (order.status === "cancelled") return { order, skipped: "encomenda cancelada" };

  if (!sendcloud.isConfigured()) {
    const updated = await updateOrder(token, (o) => {
      if (hasShipment(o)) return false;
      o.shippingStatus = "not_configured";
      o.shippingError = sendcloud.NOT_CONFIGURED;
    });
    return { order: updated, skipped: "sendcloud não configurado" };
  }
  if (!order.shippingOptionCode) {
    const updated = await updateOrder(token, (o) => {
      o.shippingStatus = "shipping_error";
      o.shippingError = "O método de envio não tem código Sendcloud (Gestão → Produtos e site → Envio).";
    });
    return { order: updated, error: updated.shippingError };
  }

  const catalog = await loadCatalog();
  try {
    const shipment = await sendcloud.createParcel(order, catalog.sender);
    const updated = await updateOrder(token, (o) => {
      if (hasShipment(o)) return false; // outro processo gravou entretanto
      o.sendcloudShipmentId = shipment.shipmentId;
      o.sendcloudParcelId = shipment.parcelId;
      o.trackingNumber = shipment.trackingNumber || o.trackingNumber || "";
      o.trackingUrl = shipment.trackingUrl || o.trackingUrl || "";
      o.labelUrl = shipment.labelUrl || "";
      o.shippingStatus = "label_ready";
      o.sendcloudStatus = shipment.statusMessage || shipment.statusCode || "";
      o.shipmentCreatedAt = new Date().toISOString();
      delete o.shippingError;
    });
    return { order: updated, created: !shipment.reused, reused: Boolean(shipment.reused) };
  } catch (err) {
    console.error(`Sendcloud (${order.number}):`, err.message);
    const updated = await updateOrder(token, (o) => {
      if (hasShipment(o)) return false;
      o.shippingStatus = "shipping_error";
      o.shippingError = err.message;
    });
    return { order: updated, error: err.message };
  }
}

// ---------------------------------------------------------------------------------------------
// Emails (cada um só é enviado automaticamente uma vez)
// ---------------------------------------------------------------------------------------------
const EMAILS = {
  confirmation: { field: "confirmationEmailSentAt", build: orderConfirmationEmail },
  shipping: { field: "shippingEmailSentAt", build: orderShippedEmail },
  pickup: { field: "pickupEmailSentAt", build: orderPickupEmail },
  delivered: { field: "deliveredEmailSentAt", build: orderDeliveredEmail },
  admin: { field: "adminEmailSentAt", build: adminNewOrderEmail }
};
export const EMAIL_TYPES = Object.keys(EMAILS);

/**
 * Envia um email da encomenda. Sem `force`, não envia se já foi enviado antes (timestamp gravado).
 * Falhas ficam registadas na encomenda (emailErrors) e nunca interrompem o fluxo.
 */
export async function sendOrderEmail(token, type, siteUrl, { force = false } = {}) {
  const def = EMAILS[type];
  if (!def) throw new Error("Tipo de email inválido");
  const order = await getOrder(token);
  if (!order) throw new Error("Encomenda não encontrada");
  if (!force && order[def.field]) return { skipped: "já enviado" };
  if (type === "pickup" && !order.servicePoint) return { skipped: "não é entrega em ponto de recolha" };

  const to = type === "admin" ? Netlify.env.get("ADMIN_ORDER_EMAIL") : order.email;
  if (!to) return { skipped: type === "admin" ? "ADMIN_ORDER_EMAIL não definido" : "sem email do cliente" };

  const contact = Netlify.env.get("EMAIL_REPLY_TO");
  const email = def.build({ ...order, trackUrl: order.trackUrl || `${siteUrl}/encomenda.html?t=${order.token}` }, siteUrl, contact);
  try {
    const sent = await sendEmail({ to, ...email });
    if (sent.skipped) {
      await updateOrder(token, (o) => { o.emailErrors = { ...(o.emailErrors || {}), [type]: "Resend ainda não configurado (RESEND_API_KEY)" }; });
      return { skipped: "Resend não configurado" };
    }
    await updateOrder(token, (o) => {
      o[def.field] = new Date().toISOString();
      if (o.emailErrors) delete o.emailErrors[type];
    });
    return { sent: true };
  } catch (err) {
    console.error(`Email ${type} (${order.number}):`, err.message);
    await updateOrder(token, (o) => { o.emailErrors = { ...(o.emailErrors || {}), [type]: err.message }; });
    return { error: err.message };
  }
}

// Emails automáticos que correspondem ao estado atual
export async function notifyForStatus(token, siteUrl) {
  const order = await getOrder(token);
  if (!order) return;
  // sendOrderEmail não repete emails já enviados (timestamps)
  if (order.status === "shipped" || order.status === "in_transit") await sendOrderEmail(token, "shipping", siteUrl);
  if (order.status === "ready_for_pickup") await sendOrderEmail(token, "pickup", siteUrl);
  if (order.status === "delivered") await sendOrderEmail(token, "delivered", siteUrl);
}

// ---------------------------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------------------------
/**
 * Aplica uma atualização de estado vinda da Sendcloud (webhook ou consulta).
 * Ignora eventos antigos/repetidos e nunca faz a encomenda recuar.
 */
export async function applyTrackingUpdate(token, { status, message, trackingNumber, trackingUrl, eventAt }) {
  let changed = false;
  const order = await updateOrder(token, (o) => {
    const at = eventAt ? new Date(eventAt).toISOString() : new Date().toISOString();
    if (o.lastTrackingEventAt && eventAt && at < o.lastTrackingEventAt) return false; // evento mais antigo
    if (trackingNumber && !o.trackingNumber) o.trackingNumber = trackingNumber;
    if (trackingUrl) o.trackingUrl = trackingUrl;
    if (message) o.sendcloudStatus = message;
    o.lastTrackingEventAt = at;
    if (status === "cancelled") o.shippingStatus = "cancelled";
    else if (status && status !== "ready_to_ship") {
      o.shippingStatus = status;
      // "ready_for_pickup" só faz sentido em entregas para ponto de recolha
      const target = status === "ready_for_pickup" && !o.servicePoint ? "in_transit" : status;
      changed = applyStatus(o, target, { at });
    }
  });
  return { order, changed };
}

export async function refreshTracking(token, siteUrl) {
  const order = await getOrder(token);
  if (!order) throw new Error("Encomenda não encontrada");
  if (!order.trackingNumber && !order.sendcloudShipmentId) return { order, skipped: "sem envio" };
  let update;
  if (order.trackingNumber) {
    const t = await sendcloud.getTracking(order.trackingNumber);
    update = { status: sendcloud.mapSendcloudStatus({ phase: t.phase, message: t.description }), message: t.description || t.phase, trackingUrl: t.trackingUrl };
  } else {
    const p = await sendcloud.getParcel(order.sendcloudShipmentId);
    update = { status: sendcloud.mapSendcloudStatus({ code: p.statusCode, message: p.statusMessage }), message: p.statusMessage, trackingNumber: p.trackingNumber, trackingUrl: p.trackingUrl };
  }
  const result = await applyTrackingUpdate(token, update);
  if (result.changed) await notifyForStatus(token, siteUrl);
  return result;
}
