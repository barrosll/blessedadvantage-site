// Cria uma sessão de pagamento na Stripe (MB WAY, Multibanco, cartão...).
// Os preços vêm SEMPRE do catálogo no servidor, nunca do browser.
import { loadCatalog, publicCatalog, CUSTOM_COLOR, MAX_NOTE } from "../lib/catalog.mjs";

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
  if (items.length === 0) return json({ error: "Carrinho vazio" }, 400);
  if (items.length > 40) return json({ error: "Demasiados produtos diferentes no carrinho" }, 400);

  const catalog = publicCatalog(await loadCatalog());
  const lineItems = [];
  const summary = [];
  const notes = {}; // notas de personalização, uma por linha, em metadata
  let subtotal = 0;
  let weight = 0;

  for (const item of items) {
    const product = catalog.products.find((p) => p.id === item.id);
    const size = product && product.options.find((o) => o.id === item.size);
    const qty = Math.floor(Number(item.qty));
    if (!product || !size || !(qty >= 1 && qty <= MAX_QTY)) {
      return json({ error: "Produto inválido no carrinho" }, 400);
    }

    // Cor: tem de ser uma das cores do produto, ou "personalizado" se o produto o permitir
    const color = String(item.color || "");
    const isCustom = color === CUSTOM_COLOR;
    const colorOk = isCustom
      ? product.custom
      : product.colors.length ? product.colors.some((c) => c.name === color) : color === "";
    if (!colorOk) return json({ error: "Escolhe uma cor válida para cada produto" }, 400);
    const note = isCustom ? String(item.note || "").trim().slice(0, MAX_NOTE) : "";
    if (isCustom && !note) return json({ error: "Escreve a nota de personalização" }, 400);

    subtotal += size.price * qty;
    weight += size.weight * qty;
    const line = lineItems.length + 1;
    summary.push(`${qty}x ${product.id}/${size.id}${color ? "/" + color : ""}`);
    if (note) notes[`nota_${line}`] = note;

    const details = [size.label, isCustom ? "Personalizado" : color].filter(Boolean).join(" · ");
    lineItems.push({
      quantity: qty,
      price_data: {
        currency: "eur",
        unit_amount: size.price,
        product_data: {
          name: `${product.title || "Produto"} — ${details}`,
          description: note ? `Nota: ${note}` : undefined
        }
      }
    });
  }

  const ship = catalog.shipping;
  const free = ship.freeFrom > 0 && subtotal >= ship.freeFrom;
  const shippingOptions = [
    {
      shipping_rate_data: {
        type: "fixed_amount",
        display_name: free ? `${ship.label} (grátis)` : ship.label,
        fixed_amount: { amount: free ? 0 : ship.price, currency: "eur" },
        delivery_estimate: {
          minimum: { unit: "business_day", value: ship.days[0] },
          maximum: { unit: "business_day", value: ship.days[1] }
        }
      }
    }
  ];

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
    allow_promotion_codes: true, // códigos de desconto criados na Stripe (ex.: 10% da newsletter)
    success_url: `${siteUrl}/sucesso.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/#carrinho`,
    metadata: {
      items: summary.join(", ").slice(0, 500),
      weight_kg: weight.toFixed(2),
      ...notes
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
