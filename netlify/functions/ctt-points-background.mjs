// Descarrega a lista de pontos CTT (até 15 min numa background function). Lançada por ctt-points.mjs.
import { isConfigured, refreshPoints, refreshKey } from "../lib/ctt.mjs";

export default async (req) => {
  if (!isConfigured() || req.headers.get("x-refresh-key") !== (await refreshKey())) return;
  try {
    const points = await refreshPoints();
    console.log(`Pontos CTT atualizados: ${points.length}`);
  } catch (err) {
    console.error("Pontos CTT:", err.message);
  }
};
