// Atualização diária da lista de lojas, postos e cacifos CTT (pedido da CTT: uma vez por dia, às 8h).
// A descarga demora ~50 s a partir da Netlify, por isso esta função só lança a background function.
import { isConfigured, refreshKey } from "../lib/ctt.mjs";

export const config = { schedule: "0 8 * * *" }; // 08:00 UTC = 8h em Portugal no inverno, 9h no verão

export default async () => {
  if (!isConfigured()) return;
  const res = await fetch(`${Netlify.env.get("URL")}/.netlify/functions/ctt-points-background`, {
    method: "POST",
    headers: { "x-refresh-key": await refreshKey() }
  });
  console.log(`Pontos CTT: atualização lançada (${res.status})`);
};
