// Encomendas guardadas no Netlify Blobs.
// Cada encomenda tem um token aleatório (usado no link "Acompanhar encomenda") e um número legível (WLB-1001).
import { getStore } from "@netlify/blobs";

export const STATUSES = ["paga", "producao", "enviada", "entregue", "cancelada"];
export const STATUS_LABELS = { paga: "Paga", producao: "Em produção", enviada: "Enviada", entregue: "Entregue", cancelada: "Cancelada" };

const orders = () => getStore({ name: "encomendas", consistency: "strong" });
const meta = () => getStore({ name: "encomendas-meta", consistency: "strong" });

const FIRST_NUMBER = 1001;

// Próximo número sequencial (WLB-1001, WLB-1002, ...)
async function nextNumber() {
  const store = meta();
  const current = (await store.get("contador", { type: "json" })) || FIRST_NUMBER - 1;
  const next = current + 1;
  await store.setJSON("contador", next);
  return `WLB-${next}`;
}

export async function getOrder(token) {
  if (!/^[a-f0-9-]{36}$/.test(token || "")) return null;
  return orders().get(token, { type: "json" });
}

export async function saveOrder(order) {
  await orders().setJSON(order.token, order);
  return order;
}

// Evita encomendas duplicadas quando a Stripe repete o webhook
export async function findTokenBySession(sessionId) {
  return meta().get(`sessao-${sessionId}`);
}

export async function createOrder(data) {
  const order = {
    ...data,
    token: crypto.randomUUID(),
    number: await nextNumber(),
    status: "paga",
    history: [{ status: "paga", at: new Date().toISOString() }]
  };
  await saveOrder(order);
  await meta().set(`sessao-${data.sessionId}`, order.token);
  return order;
}

export async function listOrders() {
  const { blobs } = await orders().list();
  const all = await Promise.all(blobs.map((b) => orders().get(b.key, { type: "json" })));
  return all.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
    tracking: o.tracking || null,
    history: o.history
  };
}
