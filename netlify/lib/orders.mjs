// Encomendas guardadas no Netlify Blobs.
// Cada encomenda tem um token aleatório (usado no link "Acompanhar encomenda") e um número legível (WLB-1001).
import { getStore } from "@netlify/blobs";

// Estado da encomenda (o cliente vê a linha do tempo a partir daqui)
export const STATUSES = ["paid", "production", "ready_to_ship", "shipped", "in_transit", "ready_for_pickup", "delivered", "cancelled", "returned"];
export const STATUS_LABELS = {
  paid: "Paga", production: "Em produção", ready_to_ship: "Preparada", shipped: "Enviada", in_transit: "Em trânsito",
  ready_for_pickup: "Disponível para recolha", delivered: "Entregue", cancelled: "Cancelada", returned: "Devolvida"
};
// Ordem normal do percurso (os avisos de tracking nunca fazem a encomenda "andar para trás")
const RANK = { paid: 0, production: 1, ready_to_ship: 2, shipped: 3, in_transit: 4, ready_for_pickup: 5, delivered: 6 };
// Estados das versões anteriores
const LEGACY = { paga: "paid", producao: "production", enviada: "shipped", entregue: "delivered", cancelada: "cancelled" };

const orders = () => getStore({ name: "encomendas", consistency: "strong" });
const meta = () => getStore({ name: "encomendas-meta", consistency: "strong" });

const FIRST_NUMBER = 1001;
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

// Próximo número sequencial (WLB-1001, WLB-1002, ...) — atómico com ETag
async function nextNumber() {
  const store = meta();
  for (let attempt = 0; attempt < 10; attempt++) {
    const entry = await store.getWithMetadata("contador", { type: "json" });
    const next = (entry ? Number(entry.data) : FIRST_NUMBER - 1) + 1;
    const res = entry
      ? await store.setJSON("contador", next, { onlyIfMatch: entry.etag })
      : await store.setJSON("contador", next, { onlyIfNew: true });
    if (res.modified) return `WLB-${next}`;
  }
  throw new Error("Não foi possível gerar o número da encomenda");
}

// Atualiza encomendas antigas para o formato atual (sem gravar)
export function normalizeOrder(o) {
  if (!o) return o;
  const status = LEGACY[o.status] || o.status;
  return {
    ...o,
    status,
    paymentStatus: o.paymentStatus || "paid",
    paidAt: o.paidAt || o.createdAt,
    confirmationEmailSentAt: o.confirmationEmailSentAt || o.confirmationSentAt || null,
    shippingEmailSentAt: o.shippingEmailSentAt || o.shippedEmailAt || null,
    history: (o.history || []).map((h) => ({ ...h, status: LEGACY[h.status] || h.status })),
    trackingNumber: o.trackingNumber || (o.tracking && o.tracking.number) || "",
    trackingUrl: o.trackingUrl || (o.tracking && o.tracking.url) || ""
  };
}

export async function getOrder(token) {
  if (!/^[a-f0-9-]{36}$/.test(token || "")) return null;
  return normalizeOrder(await orders().get(token, { type: "json" }));
}

export async function saveOrder(order) {
  await orders().setJSON(order.token, order);
  await indexOrder(order);
  return order;
}

// Atualização segura: lê, aplica a alteração e grava só se ninguém alterou entretanto (ETag)
export async function updateOrder(token, change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = await orders().getWithMetadata(token, { type: "json" });
    if (!entry) throw new Error("Encomenda não encontrada");
    const order = normalizeOrder(entry.data);
    const result = await change(order);
    if (result === false) return order; // nada a alterar
    const res = await orders().setJSON(token, order, { onlyIfMatch: entry.etag });
    if (res.modified) {
      await indexOrder(order);
      return order;
    }
  }
  throw new Error("A encomenda está a ser alterada por outro processo; tenta de novo");
}

// Índices: envio Sendcloud → encomenda e número → encomenda (usados pelo webhook do tracking)
async function indexOrder(o) {
  const m = meta();
  if (o.number) await m.set(`numero-${o.number}`, o.token);
  if (o.sendcloudParcelId) await m.set(`parcel-${o.sendcloudParcelId}`, o.token);
}

export async function findTokenByParcel(parcelId) {
  return parcelId ? meta().get(`parcel-${parcelId}`) : null;
}
export async function findTokenByNumber(number) {
  return number ? meta().get(`numero-${number}`) : null;
}

// ---------------------------------------------------------------------------------------------
// Idempotência do pagamento: uma sessão Stripe = uma encomenda
// ---------------------------------------------------------------------------------------------
export async function findTokenBySession(sessionId) {
  const v = await meta().get(`sessao-${sessionId}`);
  return v && /^[a-f0-9-]{36}$/.test(v) ? v : null;
}

/**
 * Reserva a sessão antes de criar a encomenda. Devolve:
 *  { token }        — encomenda já existe
 *  { claimed:true } — esta execução ficou responsável por criar a encomenda
 *  { busy:true }    — outra execução está a criá-la agora
 * Uma reserva "presa" (execução que falhou a meio) expira ao fim de 5 minutos.
 */
export async function claimSession(sessionId) {
  const store = meta();
  const key = `sessao-${sessionId}`;
  const claim = JSON.stringify({ pending: true, at: Date.now() });
  const created = await store.set(key, claim, { onlyIfNew: true });
  if (created.modified) return { claimed: true };

  const entry = await store.getWithMetadata(key);
  if (!entry) return claimSession(sessionId);
  if (/^[a-f0-9-]{36}$/.test(entry.data)) return { token: entry.data };
  let at = 0;
  try { at = JSON.parse(entry.data).at; } catch {}
  if (Date.now() - at > CLAIM_TIMEOUT_MS) {
    const takeover = await store.set(key, claim, { onlyIfMatch: entry.etag });
    if (takeover.modified) return { claimed: true };
  }
  return { busy: true };
}

/**
 * Token da encomenda derivado do pagamento: HMAC-SHA256(segredo, id da sessão Stripe) em formato UUID.
 * Continua impossível de adivinhar (depende de um segredo do servidor), mas é sempre o mesmo para o mesmo
 * pagamento — por isso dois avisos simultâneos da Stripe escrevem no MESMO registo e nunca criam duas encomendas,
 * mesmo que as escritas condicionais falhem.
 */
export async function orderTokenForSession(sessionId) {
  const secret = Netlify.env.get("STRIPE_WEBHOOK_SECRET") || Netlify.env.get("ADMIN_PASSWORD") || "welabb";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const h = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("encomenda:" + sessionId)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function createOrder(data) {
  const token = await orderTokenForSession(data.sessionId);
  const existing = await orders().get(token, { type: "json" });
  if (existing) {
    await meta().set(`sessao-${data.sessionId}`, token);
    return { order: normalizeOrder(existing), created: false };
  }
  const now = new Date().toISOString();
  const order = {
    ...data,
    token,
    number: await nextNumber(),
    status: "paid",
    paymentStatus: "paid",
    paidAt: data.paidAt || now,
    history: [{ status: "paid", at: now }]
  };
  const res = await orders().setJSON(order.token, order, { onlyIfNew: true });
  if (!res.modified) {
    // Outro pedido do mesmo pagamento gravou primeiro: usa a encomenda dele
    await meta().set(`sessao-${data.sessionId}`, token);
    return { order: normalizeOrder(await orders().get(token, { type: "json" })), created: false };
  }
  await indexOrder(order);
  await meta().set(`sessao-${data.sessionId}`, order.token);
  return { order, created: true };
}

export async function listOrders() {
  const store = orders();
  const keys = [];
  for await (const page of store.list({ paginate: true })) keys.push(...page.blobs.map((b) => b.key));
  const all = [];
  // Leitura em grupos de 20 para não abrir centenas de pedidos ao mesmo tempo
  for (let i = 0; i < keys.length; i += 20) {
    const chunk = await Promise.all(keys.slice(i, i + 20).map((k) => store.get(k, { type: "json" })));
    all.push(...chunk.filter(Boolean).map(normalizeOrder));
  }
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Muda o estado (registando o histórico). Por defeito não deixa o tracking fazer a encomenda
 * recuar (ex.: "em trânsito" não volta a "enviada"); o admin pode forçar.
 */
export function applyStatus(order, status, { force = false, at } = {}) {
  if (!STATUSES.includes(status) || order.status === status) return false;
  const terminal = ["cancelled", "returned", "delivered"];
  if (!force) {
    if (terminal.includes(order.status) && status !== "returned") return false;
    if (RANK[status] != null && RANK[order.status] != null && RANK[status] < RANK[order.status]) return false;
  }
  const time = at || new Date().toISOString();
  order.status = status;
  order.history = [...(order.history || []), { status, at: time }];
  if (status === "shipped" && !order.shippedAt) order.shippedAt = time;
  if (status === "in_transit" && !order.shippedAt) order.shippedAt = time;
  if (status === "ready_for_pickup" && !order.readyForPickupAt) order.readyForPickupAt = time;
  if (status === "delivered" && !order.deliveredAt) order.deliveredAt = time;
  return true;
}

// Só o que o cliente precisa de ver na página da encomenda
export function publicOrder(o) {
  return {
    number: o.number,
    status: o.status,
    firstName: o.firstName,
    createdAt: o.createdAt,
    eta: o.eta,
    items: o.items,
    subtotal: o.subtotal,
    shipping: o.shipping,
    discount: o.discount,
    total: o.total,
    address: o.address,
    shippingMethodName: o.shippingMethodName || "",
    shippingCarrier: o.shippingCarrier || "",
    servicePoint: o.servicePoint || null,
    trackingNumber: o.trackingNumber || "",
    trackingUrl: o.trackingUrl || "",
    history: o.history
  };
}
