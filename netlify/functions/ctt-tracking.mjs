// Tracking CTT: consulta os eventos das encomendas CTT ainda em curso e envia os emails de estado.
// A CTT não envia avisos (webhook) — por isso consulta-se de 2 em 2 horas durante o dia.
import { isConfigured } from "../lib/ctt.mjs";
import { listOrders } from "../lib/orders.mjs";
import { refreshCttTracking } from "../lib/fulfillment.mjs";

export const config = { schedule: "0 7-21/2 * * *" }; // UTC

const DONE = ["delivered", "cancelled", "returned"];

export default async () => {
  if (!isConfigured()) return;
  const active = (await listOrders()).filter((o) => o.cttObject && !DONE.includes(o.status));
  if (!active.length) return;
  try {
    const results = await refreshCttTracking(active, Netlify.env.get("URL"));
    console.log(`Tracking CTT: ${active.length} consultadas, ${results.filter((r) => r.changed).length} com novo estado`);
  } catch (err) {
    console.error("Tracking CTT:", err.message);
  }
};
