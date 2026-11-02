// Atualização diária da lista de lojas, postos e cacifos CTT (pedido da CTT: uma vez por dia, às 8h).
// A pesquisa no checkout também recarrega a lista se tiver mais de 26 h.
import { isConfigured, refreshPoints } from "../lib/ctt.mjs";

export const config = { schedule: "0 8 * * *" }; // 08:00 UTC = 8h em Portugal no inverno, 9h no verão

export default async () => {
  if (!isConfigured()) return;
  try {
    const points = await refreshPoints();
    console.log(`Pontos CTT atualizados: ${points.length}`);
  } catch (err) {
    console.error("Pontos CTT:", err.message);
  }
};
