// Avisos de tracking da Sendcloud (evento "parcel_status_changed").
// Autenticação: cabeçalho Sendcloud-Signature = HMAC-SHA256 (hex) do corpo bruto com a chave secreta
// (SENDCLOUD_WEBHOOK_SECRET se definida, senão SENDCLOUD_SECRET_KEY) — conforme a documentação da Sendcloud.
import { verifyWebhook, mapSendcloudStatus } from "../lib/sendcloud.mjs";
import { findTokenByParcel, findTokenByNumber } from "../lib/orders.mjs";
import { applyTrackingUpdate, notifyForStatus, siteUrlFrom } from "../lib/fulfillment.mjs";

export const config = { path: "/api/sendcloud-webhook" };

export default async (req) => {
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });

  const raw = await req.text();
  if (!(await verifyWebhook(raw, req.headers.get("sendcloud-signature")))) {
    return new Response("Assinatura inválida", { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }
  if (event.action !== "parcel_status_changed" || !event.parcel) return new Response("ignorado");

  const p = event.parcel;
  const token = (await findTokenByParcel(p.id)) || (await findTokenByNumber(p.order_number));
  if (!token) {
    // Envio que não é desta loja (ou criado à mão no painel): responder 200 para a Sendcloud não repetir
    console.log("Sendcloud: envio sem encomenda correspondente", p.id, p.order_number);
    return new Response("ok");
  }

  const status = mapSendcloudStatus({ id: p.status && p.status.id, message: p.status && p.status.message });
  const ts = event.carrier_status_change_timestamp || event.timestamp;
  const eventAt = ts ? new Date(Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000) : null;

  try {
    const { order, changed } = await applyTrackingUpdate(token, {
      status,
      message: p.status && p.status.message,
      trackingNumber: p.tracking_number,
      trackingUrl: p.tracking_url,
      eventAt
    });
    console.log(`Sendcloud: ${order.number} → ${p.status && p.status.message} (${status || "sem mudança"})`);
    if (changed) await notifyForStatus(token, siteUrlFrom(req));
  } catch (err) {
    console.error("Sendcloud webhook:", err.message);
    return new Response("Erro", { status: 500 }); // a Sendcloud volta a tentar
  }
  return new Response("ok");
};
