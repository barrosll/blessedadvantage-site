// Recebe a confirmação de pagamento da Stripe e cria o envio no Sendcloud (CTT / InPost).
// Nota: com Multibanco o pagamento só chega quando o cliente paga a referência,
// por isso tratamos "completed" (pago na hora) e "async_payment_succeeded" (pago depois).
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

async function createSendcloudParcel(session) {
  const publicKey = Netlify.env.get("SENDCLOUD_PUBLIC_KEY");
  const secretKey = Netlify.env.get("SENDCLOUD_SECRET_KEY");
  if (!publicKey || !secretKey) {
    console.log("Sendcloud não configurado — envio não criado para", session.id);
    return;
  }

  const shipping =
    (session.collected_information && session.collected_information.shipping_details) ||
    session.shipping_details;
  const customer = session.customer_details || {};
  const address = (shipping && shipping.address) || customer.address || {};
  const methodId = Netlify.env.get("SENDCLOUD_SHIPPING_METHOD_ID");

  const parcel = {
    name: (shipping && shipping.name) || customer.name,
    email: customer.email,
    telephone: customer.phone,
    address: address.line1,
    address_2: address.line2 || "",
    city: address.city,
    postal_code: address.postal_code,
    country: address.country || "PT",
    order_number: session.id.slice(-12),
    weight: (session.metadata && session.metadata.weight_kg) || "0.5",
    // Sem método definido, a encomenda fica no painel do Sendcloud para gerar a etiqueta à mão
    request_label: Boolean(methodId)
  };
  if (methodId) parcel.shipment = { id: Number(methodId) };

  const res = await fetch("https://panel.sendcloud.sc/api/v2/parcels", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${publicKey}:${secretKey}`),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ parcel })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Lançar o erro faz a Stripe repetir o webhook mais tarde
    throw new Error(`Sendcloud ${res.status}: ${JSON.stringify(data.error || data)}`);
  }
  console.log("Envio criado no Sendcloud:", data.parcel && data.parcel.id, "tracking:", data.parcel && data.parcel.tracking_number);
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
    console.log("Encomenda paga:", session.id, session.metadata && session.metadata.items);
    try {
      await createSendcloudParcel(session);
    } catch (err) {
      console.error(err.message);
      return new Response("Erro ao criar envio", { status: 500 });
    }
  }

  return new Response("ok");
};
