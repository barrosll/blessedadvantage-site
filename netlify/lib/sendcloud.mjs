// Sendcloud — todas as chamadas à API passam por este módulo (só backend).
//
// Usa a API v3 (https://sendcloud.dev/api/v3): a API v2 de criação de envios está fechada a contas
// criadas depois de 13/04/2026. Autenticação HTTP Basic com SENDCLOUD_PUBLIC_KEY / SENDCLOUD_SECRET_KEY.
//
// Endpoints usados (documentação oficial):
//   POST /api/v3/shipping-options                       opções de envio disponíveis (+ preço contratual)
//   GET  /api/v3/service-points                         pesquisa de pontos de recolha
//   GET  /api/v3/service-points/{id}                    validar um ponto de recolha
//   POST /api/v3/shipments/announce                     criar e anunciar envio (etiqueta), idempotente por external_reference_id
//   GET  /api/v3/shipments/{id}                         consultar envio
//   POST /api/v3/shipments/{id}/cancel                  cancelar envio
//   GET  /api/v3/parcels/{id}/documents/label           etiqueta PDF de um volume
//   GET  /api/v3/parcel-documents/label?parcels=…       etiquetas de vários volumes num PDF (máx. 20)
//   GET  /api/v3/parcels/tracking/{tracking_number}     tracking
//
// SENDCLOUD_MOCK=1 ativa respostas simuladas — só funciona dentro do `netlify dev` (NETLIFY_DEV=true),
// para testar o fluxo completo sem conta. Nunca é usado no site publicado.

const BASE = "https://panel.sendcloud.sc/api/v3";
export const LABEL_BATCH_SIZE = 20; // limite da Sendcloud por pedido de etiquetas em lote

export class SendcloudError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function credentials() {
  const pub = Netlify.env.get("SENDCLOUD_PUBLIC_KEY");
  const secret = Netlify.env.get("SENDCLOUD_SECRET_KEY");
  return pub && secret ? { pub, secret } : null;
}

export function isMock() {
  return Netlify.env.get("SENDCLOUD_MOCK") === "1" && Netlify.env.get("NETLIFY_DEV") === "true";
}

export function isConfigured() {
  return isMock() || Boolean(credentials());
}

export const NOT_CONFIGURED =
  "Sendcloud ainda não está configurado (faltam SENDCLOUD_PUBLIC_KEY e SENDCLOUD_SECRET_KEY nas variáveis da Netlify).";

async function request(path, { method = "GET", body, query, accept = "application/json" } = {}) {
  const creds = credentials();
  if (!creds) throw new SendcloudError(NOT_CONFIGURED, 503);

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null || v === "") continue;
    for (const item of [].concat(v)) url.searchParams.append(k, String(item));
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: "Basic " + btoa(`${creds.pub}:${creds.secret}`),
        Accept: accept,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new SendcloudError("Sendcloud indisponível: " + err.message, 503);
  }
  if (accept === "application/pdf" && res.ok) return new Uint8Array(await res.arrayBuffer());

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = (data && (data.errors || data.error || data.message || data.detail)) || text.slice(0, 300);
    throw new SendcloudError(`Sendcloud ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, res.status, data);
  }
  return data;
}

const list = (data) => (Array.isArray(data) ? data : (data && data.data) || []);

// ---------------------------------------------------------------------------------------------
// Opções de envio (para o admin escolher quais oferecer; inclui o preço contratual quando disponível)
// ---------------------------------------------------------------------------------------------
export async function getShippingMethods({ fromPostalCode, toPostalCode = "1000-001", weightKg = 1 } = {}) {
  if (isMock()) return mock.shippingOptions();
  const data = await request("/shipping-options", {
    method: "POST",
    body: {
      from_address: { country_code: "PT", ...(fromPostalCode ? { postal_code: fromPostalCode } : {}) },
      to_address: { country_code: "PT", postal_code: toPostalCode },
      parcels: [{ weight: { value: String(weightKg), unit: "kg" } }],
      calculate_quotes: true
    }
  });
  return list(data).map((o) => {
    const quote = (o.quotes || []).find((q) => q.price && q.price.total);
    return {
      code: o.code,
      name: o.name,
      carrier: (o.carrier && o.carrier.code) || "",
      carrierName: (o.carrier && o.carrier.name) || "",
      lastMile: (o.functionalities && o.functionalities.last_mile) || "",
      requiresServicePoint: Boolean(o.requirements && o.requirements.is_service_point_required),
      quote: quote ? { value: quote.price.total.value, currency: quote.price.total.currency } : null
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Pontos de recolha
// ---------------------------------------------------------------------------------------------
function simplifyPoint(p) {
  const a = p.address || {};
  return {
    id: String(p.id),
    name: p.name || "",
    carrier: (p.carrier && p.carrier.code) || "",
    type: p.general_shop_type || "",
    street: [a.street, a.house_number].filter(Boolean).join(" "),
    postalCode: a.postal_code || "",
    city: a.city || "",
    distance: typeof p.distance === "number" ? p.distance : null,
    openingTimes: p.opening_times || null,
    isExpired: Boolean(p.is_expired)
  };
}

export async function getServicePoints({ carrier, query, latitude, longitude, limit = 20 }) {
  if (isMock()) return mock.servicePoints(carrier, query);
  const params = { country_code: "PT", carrier_code: carrier || undefined, limit, radius: 10000 };
  if (latitude != null && longitude != null) Object.assign(params, { latitude, longitude });
  else params.address = query;
  const data = await request("/service-points", { query: params });
  return list(data).map(simplifyPoint);
}

export async function getServicePoint(id) {
  if (isMock()) return mock.servicePoint(id);
  const data = await request(`/service-points/${encodeURIComponent(id)}`);
  return simplifyPoint((data && data.data) || data);
}

// ---------------------------------------------------------------------------------------------
// Envios
// ---------------------------------------------------------------------------------------------
function splitStreet(line) {
  // "Rua Melo Antunes 12" / "Rua Melo Antunes, 12" -> rua + número (a Sendcloud aceita o número em separado)
  const m = String(line || "").match(/^(.*?)[,\s]+(\d+[A-Za-z]?(?:[-/]\d+)?)\s*$/);
  return m ? { street: m[1].trim(), number: m[2] } : { street: String(line || "").trim(), number: "" };
}

function simplifyShipment(data) {
  const s = (data && data.data) || data || {};
  const parcel = (s.parcels || [])[0] || {};
  const label = (parcel.documents || []).find((d) => d.type === "label");
  return {
    shipmentId: s.id != null ? String(s.id) : "",
    parcelId: parcel.id != null ? String(parcel.id) : "",
    trackingNumber: parcel.tracking_number || "",
    trackingUrl: parcel.tracking_url || "",
    labelUrl: (label && label.link) || "",
    statusCode: (parcel.status && parcel.status.code) || "",
    statusMessage: (parcel.status && parcel.status.message) || ""
  };
}

/**
 * Cria e anuncia o envio (gera etiqueta). Idempotente: usa o número da encomenda como
 * external_reference_id — se já existir, a Sendcloud responde 409 com o envio existente.
 */
export async function createParcel(order, sender) {
  if (isMock()) return mock.createParcel(order);
  if (!sender || !sender.name || !sender.street || !sender.postalCode || !sender.city) {
    throw new SendcloudError("Falta a morada do remetente (Gestão → Produtos e site → Envio).", 400);
  }
  const a = order.address;
  const to = splitStreet(a.line1);
  const from = splitStreet(sender.street);
  const body = {
    external_reference_id: order.number,
    order_number: order.number,
    to_address: {
      name: a.name,
      address_line_1: to.street,
      ...(to.number ? { house_number: to.number } : {}),
      ...(a.line2 ? { address_line_2: a.line2 } : {}),
      postal_code: a.postalCode,
      city: a.city,
      country_code: a.country || "PT",
      ...(order.email ? { email: order.email } : {}),
      ...(order.phone ? { phone_number: order.phone } : {})
    },
    from_address: {
      name: sender.name,
      address_line_1: from.street,
      ...(from.number ? { house_number: from.number } : {}),
      postal_code: sender.postalCode,
      city: sender.city,
      country_code: "PT",
      ...(sender.email ? { email: sender.email } : {}),
      ...(sender.phone ? { phone_number: sender.phone } : {})
    },
    ship_with: { type: "shipping_option_code", properties: { shipping_option_code: order.shippingOptionCode } },
    parcels: [{ weight: { value: String(order.parcelWeight), unit: "kg" } }],
    total_order_price: { value: (order.total / 100).toFixed(2), currency: "EUR" },
    label_details: { mime_type: "application/pdf" },
    ...(order.servicePoint ? { to_service_point: { id: String(order.servicePoint.id) } } : {})
  };
  try {
    return simplifyShipment(await request("/shipments/announce", { method: "POST", body }));
  } catch (err) {
    // 409 = já existe um envio com este external_reference_id: reaproveitar o existente
    if (err.status === 409 && err.details && (err.details.data || err.details.parcels)) {
      return { ...simplifyShipment(err.details), reused: true };
    }
    throw err;
  }
}

export async function getParcel(shipmentId) {
  if (isMock()) return mock.getParcel(shipmentId);
  return simplifyShipment(await request(`/shipments/${encodeURIComponent(shipmentId)}`));
}

export async function cancelParcel(shipmentId) {
  if (isMock()) return { cancelled: true, queued: false };
  await request(`/shipments/${encodeURIComponent(shipmentId)}/cancel`, { method: "POST" });
  return { cancelled: true };
}

export async function getTracking(trackingNumber) {
  if (isMock()) return mock.tracking(trackingNumber);
  const data = await request(`/parcels/tracking/${encodeURIComponent(trackingNumber)}`);
  const d = (data && data.data) || data || {};
  const events = d.events || d.parcel_events || [];
  const last = events[events.length - 1] || {};
  return {
    phase: d.phase || last.phase || "",
    description: d.description || last.description || "",
    trackingUrl: d.tracking_url || "",
    expectedDeliveryDate: d.expected_delivery_date || null
  };
}

// Etiqueta PDF A6 de um volume
export async function getLabel(parcelId) {
  if (isMock()) return mock.pdf(`Etiqueta ${parcelId}`);
  return request(`/parcels/${encodeURIComponent(parcelId)}/documents/label`, { query: { paper_size: "A6" }, accept: "application/pdf" });
}

// Etiquetas de até 20 volumes num único PDF A6 (endpoint oficial de lote)
export async function getLabels(parcelIds) {
  if (parcelIds.length > LABEL_BATCH_SIZE) throw new SendcloudError(`Máximo ${LABEL_BATCH_SIZE} etiquetas por pedido`, 400);
  if (isMock()) return mock.pdf(`Etiquetas ${parcelIds.join(", ")}`);
  return request("/parcel-documents/label", { query: { parcels: parcelIds, paper_size: "A6" }, accept: "application/pdf" });
}

// ---------------------------------------------------------------------------------------------
// Estados → estados internos da encomenda
// ---------------------------------------------------------------------------------------------
// IDs confirmados na documentação: 1000 (pronto para envio), 11 (entregue), 2000 (cancelado).
// Os restantes são reconhecidos pela mensagem/fase (a lista completa está em GET /api/v3/parcels/statuses).
export function mapSendcloudStatus({ id, message, code, phase } = {}) {
  const n = Number(id);
  if (n === 2000) return "cancelled";
  if (n === 11) return "delivered";
  if (n === 1000) return "ready_to_ship";
  const text = `${code || ""} ${message || ""} ${phase || ""}`.toLowerCase();
  if (/cancel/.test(text)) return "cancelled";
  if (/return/.test(text)) return "returned";
  if (/(pick ?up|collect|awaiting customer|ready_for_pickup|levant|recolha)/.test(text) && !/picked up by (driver|carrier)/.test(text)) return "ready_for_pickup";
  if (/delivered/.test(text) && !/(not|attempt|fail|undeliver)/.test(text)) return "delivered";
  if (/(en route|in_transit|in transit|sorting|driver|picked up|accepted|transit|hub|depot|out for delivery)/.test(text)) return "in_transit";
  if (/(ready to send|announced|ready_to_send)/.test(text)) return "ready_to_ship";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Verificação do webhook da Sendcloud (HMAC-SHA256 do corpo bruto, cabeçalho Sendcloud-Signature)
// ---------------------------------------------------------------------------------------------
export async function verifyWebhook(rawBody, signature) {
  const secret = Netlify.env.get("SENDCLOUD_WEBHOOK_SECRET") || Netlify.env.get("SENDCLOUD_SECRET_KEY");
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = signature.trim().toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Executa tarefas com concorrência limitada (ex.: 5 de cada vez), sem parar nas falhas
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await fn(items[i], i) }; } catch (error) { results[i] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------------------------
// Simulação local (SENDCLOUD_MOCK=1 dentro do netlify dev)
// ---------------------------------------------------------------------------------------------
const mock = {
  shippingOptions: () => [
    { code: "inpost_pt:locker", name: "InPost Locker (simulado)", carrier: "inpost_pt", carrierName: "InPost", lastMile: "locker", requiresServicePoint: true, quote: { value: "2.90", currency: "EUR" } },
    { code: "ctt:service_point", name: "CTT Ponto de recolha (simulado)", carrier: "ctt", carrierName: "CTT", lastMile: "service_point", requiresServicePoint: true, quote: { value: "3.20", currency: "EUR" } },
    { code: "ctt:home", name: "CTT Expresso em casa (simulado)", carrier: "ctt", carrierName: "CTT", lastMile: "home_delivery", requiresServicePoint: false, quote: { value: "4.10", currency: "EUR" } }
  ],
  servicePoints(carrier, query) {
    if (String(query || "").toLowerCase().includes("erro")) throw new SendcloudError("Sendcloud indisponível (simulado)", 503);
    const base = carrier && carrier.startsWith("inpost") ? "InPost Locker" : "CTT Ponto";
    return [1, 2, 3].map((n) => ({
      id: `${carrier || "sp"}-${n}`, name: `${base} ${["Montijo Centro", "Atalaia", "Alcochete"][n - 1]}`, carrier: carrier || "",
      type: carrier && carrier.startsWith("inpost") ? "locker" : "servicepoint", street: `Rua de Teste ${n * 10}`,
      postalCode: `2870-${100 + n}`, city: ["Montijo", "Atalaia", "Alcochete"][n - 1], distance: n * 850,
      openingTimes: { 0: [{ start_time: "08:00", end_time: "22:00" }] }, isExpired: false
    }));
  },
  servicePoint(id) {
    const m = String(id).match(/^(.*)-(\d)$/);
    if (!m) throw new SendcloudError("Ponto de recolha não encontrado", 404);
    return mock.servicePoints(m[1], "").find((p) => p.id === id);
  },
  // Regista cada criação (para os testes confirmarem que não há envios duplicados).
  // Código de envio "mock:falha-1x" falha na 1.ª tentativa de cada encomenda (simula a Sendcloud em baixo).
  async createParcel(order) {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: "sendcloud-teste", consistency: "strong" });
    const attempts = ((await store.get(`tentativas-${order.number}`, { type: "json" })) || 0) + 1;
    await store.setJSON(`tentativas-${order.number}`, attempts);
    if (order.shippingOptionCode === "mock:falha-1x" && attempts === 1) throw new SendcloudError("Sendcloud indisponível (simulado)", 503);
    await store.setJSON(`criado-${order.number}-${attempts}`, { at: Date.now() });
    const n = order.number.replace(/\D/g, "");
    return { shipmentId: `shp_${n}`, parcelId: `9${n}`, trackingNumber: `MOCK${n}PT`, trackingUrl: `https://tracking.example/${n}`, labelUrl: "", statusCode: "READY_TO_SEND", statusMessage: "Ready to send" };
  },
  getParcel: (id) => ({ shipmentId: id, parcelId: "", trackingNumber: "", trackingUrl: "", labelUrl: "", statusCode: "READY_TO_SEND", statusMessage: "Ready to send" }),
  tracking: () => ({ phase: "in_transit", description: "Em trânsito (simulado)", trackingUrl: "", expectedDeliveryDate: null }),
  pdf(text) {
    // PDF mínimo válido (A6 = 298×420 pt) só para testes locais
    const content = `BT /F1 14 Tf 20 380 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 298 420] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new TextEncoder().encode(pdf);
  }
};
