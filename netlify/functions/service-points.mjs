// Pesquisa de pontos de recolha (InPost / CTT) para o checkout.
// O browser só envia o método e o código postal/localidade (ou coordenadas); a chamada à Sendcloud é feita aqui.
import { loadCatalog, findMethod } from "../lib/catalog.mjs";
import { getServicePoints, isConfigured, NOT_CONFIGURED } from "../lib/sendcloud.mjs";

export const config = { path: "/api/service-points" };

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": status ? "no-store" : "public, max-age=300" }
  });
}

export default async (req) => {
  const params = new URL(req.url).searchParams;
  const method = findMethod(await loadCatalog(), params.get("method") || "");
  if (!method || !method.requiresServicePoint) return json({ error: "Método de entrega inválido" }, 400);
  if (!isConfigured()) return json({ error: "A pesquisa de pontos de recolha ainda não está disponível. " + NOT_CONFIGURED }, 503);

  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const hasCoords = params.has("lat") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const query = String(params.get("q") || "").trim().slice(0, 60);
  if (!hasCoords && query.length < 3) return json({ error: "Escreve o código postal ou a localidade" }, 400);

  try {
    const points = await getServicePoints({
      carrier: method.carrier,
      query: hasCoords ? undefined : `${query}, Portugal`,
      latitude: hasCoords ? lat.toFixed(5) : undefined,
      longitude: hasCoords ? lng.toFixed(5) : undefined,
      limit: 20
    });
    return json({ points: points.filter((p) => !p.isExpired).slice(0, 20) });
  } catch (err) {
    console.error("Pontos de recolha:", err.message);
    return json({ error: "Não foi possível procurar pontos de recolha agora. Tenta novamente." }, 502);
  }
};
