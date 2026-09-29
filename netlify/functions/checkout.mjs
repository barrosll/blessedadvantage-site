// Cria uma sessão de pagamento na Stripe (MB WAY, Multibanco, cartão...).
// Os preços vêm SEMPRE do products.json no servidor, nunca do browser.
import catalog from "../../products.json";

export const config = { path: "/api/checkout" };

const MAX_QTY = 20;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

// Converte um objeto em form-urlencoded no formato que a API da Stripe espera (a[b][0]=c)
function toForm(obj, prefix, out) {
  out = out || new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") toForm(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!secretKey) return json({ error: "Pagamentos ainda não configurados" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Pedido inválido" }, 400);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > 50) return json({ error: "Carrinho vazio" }, 400);

  const lineItems = [];
  const summary = [];
  let subtotal = 0;
  let weight = 0;

  for (const item of items) {
    const product = catalog.products.find((p) => p.id === item.id);
    const size = catalog.sizes.find((s) => s.id === item.size);
    const qty = Math.floor(Number(item.qty));
    if (!product || !size || !(qty >= 1 && qty <= MAX_QTY)) {
      return json({ error: "Produto inválido no carrinho" }, 400);
    }
    subtotal += size.price * qty;
    weight += size.weight * qty;
    summary.push(`${qty}x ${product.id}/${size.id}`);
    lineItems.push({
      quantity: qty,
      price_data: {
        currency: "eur",
        unit_amount: size.price,
        product_data: { name: `${product.title} — ${size.label}` }
      }
    });
  }

  const shippingOptions = catalog.shipping
    .filter((s) => !s.minSubtotal || subtotal >= s.minSubtotal)
    .filter((s, _, all) => s.price === 0 || !all.some((o) => o.price === 0)) // se há envio grátis, mostra só esse
    .map((s) => ({
      shipping_rate_data: {
        type: "fixed_amount",
        display_name: s.label,
        fixed_amount: { amount: s.price, currency: "eur" },
        delivery_estimate: {
          minimum: { unit: "business_day", value: s.days[0] },
          maximum: { unit: "business_day", value: s.days[1] }
        },
        metadata: { shipping_id: s.id }
      }
    }));

  const siteUrl = Netlify.env.get("URL") || new URL(req.url).origin;

  const params = toForm({
    mode: "payment",
    locale: "pt",
    line_items: lineItems,
    shipping_address_collection: { allowed_countries: ["PT"] },
    shipping_options: shippingOptions,
    phone_number_collection: { enabled: true }, // necessário para as etiquetas CTT/InPost
    tax_id_collection: { enabled: true }, // NIF para a fatura
    billing_address_collection: "auto",
    success_url: `${siteUrl}/sucesso.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/#carrinho`,
    metadata: {
      items: summary.join(", ").slice(0, 500),
      weight_kg: weight.toFixed(2)
    }
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const session = await res.json();

  if (!res.ok) {
    console.error("Erro Stripe:", session.error && session.error.message);
    return json({ error: "Não foi possível iniciar o pagamento" }, 502);
  }

  return json({ url: session.url });
};
