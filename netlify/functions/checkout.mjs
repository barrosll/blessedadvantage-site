// Cria uma sessão de pagamento na Stripe (MB WAY, Multibanco, cartão...).
// Os preços vêm SEMPRE do catálogo no servidor, nunca do browser.
import { loadCatalog, publicCatalog, findMethod, shippingPrice, CUSTOM_COLOR, MAX_NOTE } from "../lib/catalog.mjs";
import { getServicePoint, isConfigured, NOT_CONFIGURED } from "../lib/sendcloud.mjs";

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

  if (Netlify.env.get("MAINTENANCE_MODE") === "1") return json({ error: "A loja está em manutenção. Voltamos em breve!" }, 503);

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
  if (items.length > 35) return json({ error: "Demasiados produtos diferentes no carrinho" }, 400); // metadata Stripe: máx. 50 campos

  const fullCatalog = await loadCatalog();
  const catalog = publicCatalog(fullCatalog);
  const siteUrl = Netlify.env.get("URL") || new URL(req.url).origin;
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
          description: note ? `Nota: ${note}` : undefined,
          images: product.images[0] ? [new URL(product.images[0], siteUrl + "/").href] : undefined,
          // Usado pelo webhook para montar a encomenda e o email
          metadata: { product_id: product.id, title: product.title || "Produto", details, note }
        }
      }
    });
  }

  // Entrega: método escolhido pelo cliente; preço e regras vêm SEMPRE do catálogo no servidor
  const delivery = body.delivery || {};
  const method = findMethod(fullCatalog, String(delivery.methodId || ""));
  if (!method) return json({ error: "Escolhe um método de entrega" }, 400);

  let point = null;
  if (method.requiresServicePoint) {
    const pointId = String(delivery.servicePointId || "").slice(0, 60);
    if (!pointId) return json({ error: "Escolhe primeiro um ponto de recolha." }, 400);
    if (!isConfigured()) return json({ error: NOT_CONFIGURED }, 503);
    // Confirma o ponto na Sendcloud (o browser não decide nome, morada nem transportadora)
    try {
      point = await getServicePoint(pointId);
    } catch (err) {
      console.error("Ponto de recolha:", err.message);
      return json({ error: err.status === 404 ? "Ponto de recolha não encontrado. Escolhe outro." : "Não foi possível confirmar o ponto de recolha. Tenta novamente." }, err.status === 404 ? 400 : 502);
    }
    if (!point || (method.carrier && point.carrier && !point.carrier.startsWith(method.carrier) && !method.carrier.startsWith(point.carrier))) {
      return json({ error: "Este ponto de recolha não pertence à transportadora escolhida." }, 400);
    }
  }

  // Peso real: variante × quantidade (do catálogo) + embalagem
  const packageKg = Math.max(0, Number(Netlify.env.get("PACKAGE_WEIGHT_KG")) || 0);
  weight += packageKg;

  const shipCost = shippingPrice(method, subtotal);
  const shipName = (point ? `${method.name} — ${point.name}` : method.name).slice(0, 100) + (shipCost === 0 ? " (grátis)" : "");
  const shippingOptions = [
    {
      shipping_rate_data: {
        type: "fixed_amount",
        display_name: shipName,
        fixed_amount: { amount: shipCost, currency: "eur" },
        delivery_estimate: {
          minimum: { unit: "business_day", value: method.days[0] },
          maximum: { unit: "business_day", value: method.days[1] }
        }
      }
    }
  ];

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
      weight_kg: weight.toFixed(3),
      shipping_method: method.id,
      ...(point
        ? {
            sp_id: point.id,
            sp_name: point.name.slice(0, 200),
            sp_address: point.street.slice(0, 200),
            sp_postal_code: point.postalCode,
            sp_city: point.city.slice(0, 100),
            sp_carrier: point.carrier
          }
        : {}),
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
