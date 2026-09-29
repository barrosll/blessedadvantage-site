// Recebe a confirmação de pagamento da Stripe e cria o envio no Sendcloud (CTT / InPost).
// Nota: com Multibanco o pagamento só chega quando o cliente paga a referência,
// por isso tratamos "completed" (pago na hora) e "async_payment_succeeded" (pago depois).
import { loadCatalog } from "../lib/catalog.mjs";
import { createOrder, findTokenBySession, saveOrder } from "../lib/orders.mjs";
import { orderConfirmationEmail, computeEta } from "../lib/emails.mjs";
import { sendEmail } from "../lib/mailer.mjs";

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

  return {
    sessionId: session.id,
    createdAt: paidAt.toISOString(),
    email: customer.email,
    name,
    firstName: titleCase(name.split(" ")[0]) || "cliente",
    phone: customer.phone || "",
    taxId: (customer.tax_ids || []).map((t) => t.value).join(", "),
    address: { name, line1: addr.line1 || "", line2: addr.line2 || "", postalCode: addr.postal_code || "", city: addr.city || "", country: addr.country || "PT" },
    items,
    subtotal: session.amount_subtotal,
    shipping: (session.total_details && session.total_details.amount_shipping) || 0,
    discount: (session.total_details && session.total_details.amount_discount) || 0,
    total: session.amount_total,
    weightKg: (session.metadata && session.metadata.weight_kg) || "0.5",
    productionDays: catalog.shipping.productionDays || [3, 5],
    shippingDays: catalog.shipping.days,
    eta: computeEta(paidAt, catalog.shipping.productionDays || [3, 5], catalog.shipping.days)
  };
}

async function createSendcloudParcel(order) {
  const publicKey = Netlify.env.get("SENDCLOUD_PUBLIC_KEY");
  const secretKey = Netlify.env.get("SENDCLOUD_SECRET_KEY");
  if (!publicKey || !secretKey) {
    console.log("Sendcloud não configurado — envio não criado para", order.number);
    return null;
  }
  const methodId = Netlify.env.get("SENDCLOUD_SHIPPING_METHOD_ID");
  const a = order.address;
  const parcel = {
    name: a.name,
    email: order.email,
    telephone: order.phone,
    address: a.line1,
    address_2: a.line2,
    city: a.city,
    postal_code: a.postalCode,
    country: a.country,
    order_number: order.number,
    weight: order.weightKg,
    // Sem método definido, a encomenda fica no painel do Sendcloud para gerar a etiqueta à mão
    request_label: Boolean(methodId)
  };
  if (methodId) parcel.shipment = { id: Number(methodId) };

  const res = await fetch("https://panel.sendcloud.sc/api/v2/parcels", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${publicKey}:${secretKey}`), "Content-Type": "application/json" },
    body: JSON.stringify({ parcel })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sendcloud ${res.status}: ${JSON.stringify(data.error || data)}`);
  return {
    id: data.parcel && data.parcel.id,
    trackingNumber: (data.parcel && data.parcel.tracking_number) || "",
    trackingUrl: (data.parcel && data.parcel.tracking_url) || ""
  };
}

async function handlePaid(sessionId, siteUrl) {
  // A Stripe pode repetir o mesmo aviso: se a encomenda já existe, não faz nada
  if (await findTokenBySession(sessionId)) {
    console.log("Encomenda já registada para", sessionId);
    return;
  }
  const session = await fetchSession(sessionId);
  const order = await createOrder(await buildOrder(session));
  order.trackUrl = `${siteUrl}/encomenda.html?t=${order.token}`;
  console.log("Nova encomenda:", order.number, order.email, (order.total / 100).toFixed(2), "€");

  // A partir daqui a encomenda já está guardada: falhas no email ou no Sendcloud ficam registadas
  // na encomenda (e visíveis na gestão), sem fazer a Stripe repetir o aviso.
  try {
    const email = orderConfirmationEmail(order, siteUrl, Netlify.env.get("EMAIL_REPLY_TO"));
    const sent = await sendEmail({ to: order.email, ...email });
    if (sent.skipped) order.emailError = "Resend ainda não configurado";
    else order.confirmationSentAt = new Date().toISOString();
  } catch (err) {
    console.error("Falha no email de confirmação:", err.message);
    order.emailError = err.message;
  }
  try {
    const parcel = await createSendcloudParcel(order);
    if (parcel) {
      order.sendcloud = parcel;
      if (parcel.trackingNumber) order.tracking = { number: parcel.trackingNumber, url: parcel.trackingUrl };
    }
  } catch (err) {
    console.error("Falha no Sendcloud:", err.message);
    order.sendcloudError = err.message;
  }
  await saveOrder(order);
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
      await handlePaid(session.id, Netlify.env.get("URL") || new URL(req.url).origin);
    } catch (err) {
      // Erro antes de a encomenda ser guardada: a Stripe volta a tentar mais tarde
      console.error("Erro ao registar encomenda:", err.message);
      return new Response("Erro ao registar encomenda", { status: 500 });
    }
  }

  return new Response("ok");
};
