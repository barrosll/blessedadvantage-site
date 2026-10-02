// Recebe a confirmação de pagamento da Stripe → cria a encomenda (uma só vez), o envio na Sendcloud e envia os emails.
// Nota: com Multibanco o pagamento só chega quando o cliente paga a referência,
// por isso tratamos "completed" (pago na hora) e "async_payment_succeeded" (pago depois).
import { loadCatalog, findMethod } from "../lib/catalog.mjs";
import { createOrder, claimSession, updateOrder } from "../lib/orders.mjs";
import { computeEta } from "../lib/emails.mjs";
import { ensureShipment, sendOrderEmail, siteUrlFrom } from "../lib/fulfillment.mjs";

export const config = { path: "/api/stripe-webhook" };

const TOLERANCE_SECONDS = 300;

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(payload, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=")).filter((p) => p[0] === "t")
  );
  const signatures = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = hex(mac);
  return signatures.some((s) => safeEqual(s, expected));
}

// Sessão completa, com as linhas da encomenda (o evento não as inclui)
async function fetchSession(id) {
  const key = Netlify.env.get("STRIPE_SECRET_KEY");
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${id}?expand[]=line_items.data.price.product`,
    { headers: { Authorization: `Bearer ${key}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${data.error && data.error.message}`);
  return data;
}

function titleCase(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : "";
}

async function buildOrder(session) {
  const catalog = await loadCatalog();
  const meta = session.metadata || {};
  const customer = session.customer_details || {};
  const shipping = (session.collected_information && session.collected_information.shipping_details) || session.shipping_details || {};
  const addr = shipping.address || customer.address || {};
  const name = shipping.name || customer.name || "";
  const paidAt = new Date();

  const items = session.line_items.data.map((li) => {
    const product = li.price.product || {};
    const m = product.metadata || {};
    return {
      productId: m.product_id || "",
      title: m.title || li.description,
      details: m.details || "",
      note: m.note || "",
      qty: li.quantity,
      unitPrice: li.price.unit_amount,
      image: (product.images && product.images[0]) || ""
    };
  });

  // Método de envio escolhido (o preço cobrado é o que a Stripe registou na sessão)
  const method = findMethod(catalog, meta.shipping_method || "") ||
    (catalog.shippingMethods || []).find((m) => m.id === meta.shipping_method) || null;
  const servicePoint = meta.sp_id
    ? { id: meta.sp_id, name: meta.sp_name || "", street: meta.sp_address || "", postalCode: meta.sp_postal_code || "", city: meta.sp_city || "", carrier: meta.sp_carrier || "" }
    : null;
  const shippingDays = (method && method.days) || catalog.shipping.days || [2, 4];
  const productionDays = catalog.shipping.productionDays || [3, 5];

  return {
    sessionId: session.id,
    createdAt: paidAt.toISOString(),
    paidAt: paidAt.toISOString(),
    email: customer.email || session.customer_email || "",
    name,
    firstName: titleCase(name.split(" ")[0]) || "cliente",
    phone: customer.phone || "",
    taxId: (customer.tax_ids || []).map((t) => t.value).join(", "),
    address: { name, line1: addr.line1 || "", line2: addr.line2 || "", postalCode: addr.postal_code || "", city: addr.city || "", country: addr.country || "PT" },
    items,
    subtotal: session.amount_subtotal,
    shipping: (session.total_details && session.total_details.amount_shipping) || 0,
    shippingPrice: (session.total_details && session.total_details.amount_shipping) || 0,
    discount: (session.total_details && session.total_details.amount_discount) || 0,
    total: session.amount_total,
    // Envio
    shippingMethod: method ? method.id : meta.shipping_method || "",
    shippingMethodName: method ? method.name : "CTT",
    shippingCarrier: method ? method.carrier : "ctt",
    shippingOptionCode: method ? method.sendcloudCode : "",
    servicePoint,
    parcelWeight: meta.weight_kg || "0.5",
    shippingStatus: "pending",
    productionDays,
    shippingDays,
    eta: computeEta(paidAt, productionDays, shippingDays)
  };
}

async function handlePaid(sessionId, siteUrl) {
  // Uma sessão de pagamento = uma encomenda, mesmo que a Stripe repita o aviso (ou envie dois em paralelo)
  const claim = await claimSession(sessionId);
  if (claim.busy) throw new Error("Encomenda a ser registada por outro pedido; a Stripe volta a tentar");

  let token = claim.token;
  if (claim.claimed) {
    const session = await fetchSession(sessionId);
    const { order, created } = await createOrder(await buildOrder(session));
    token = order.token;
    if (!created) {
      // Outro aviso do mesmo pagamento criou a encomenda ao mesmo tempo: ele trata do envio e dos emails
      console.log("Encomenda já criada por outro aviso:", order.number);
      return;
    }
    await updateOrder(token, (o) => { o.trackUrl = `${siteUrl}/encomenda.html?t=${o.token}`; });
    console.log("Nova encomenda:", order.number, order.email, (order.total / 100).toFixed(2), "€", order.shippingMethodName);
  } else {
    console.log("Encomenda já registada para", sessionId, "— a completar passos em falta (se houver)");
  }

  // Passos seguintes: cada um é idempotente, por isso um aviso repetido só completa o que falta.
  // Falhas (Sendcloud/Resend) ficam registadas na encomenda e não afetam o pagamento.
  await ensureShipment(token);
  await sendOrderEmail(token, "confirmation", siteUrl);
  await sendOrderEmail(token, "admin", siteUrl);
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });

  const secret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  const payload = await req.text();
  if (!secret || !(await verifySignature(payload, req.headers.get("stripe-signature"), secret))) {
    return new Response("Assinatura inválida", { status: 400 });
  }

  const event = JSON.parse(payload);
  const session = event.data.object;

  const paid =
    (event.type === "checkout.session.completed" && session.payment_status === "paid") ||
    event.type === "checkout.session.async_payment_succeeded";

  if (paid) {
    try {
      await handlePaid(session.id, siteUrlFrom(req));
    } catch (err) {
      // Só chega aqui se a encomenda não pôde ser registada: a Stripe volta a tentar mais tarde
      console.error("Erro ao registar encomenda:", err.message);
      return new Response("Erro ao registar encomenda", { status: 500 });
    }
  }

  return new Response("ok");
};
