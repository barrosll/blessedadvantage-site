// Página "A minha encomenda": devolve o estado da encomenda a partir do token do link do email
import { getOrder, publicOrder, findTokenBySession } from "../lib/orders.mjs";

export const config = { path: "/api/order" };

export default async (req) => {
  const params = new URL(req.url).searchParams;
  // Página "Obrigado": a partir do id da sessão Stripe (também secreto) descobre a encomenda
  const session = params.get("session");
  if (session && /^cs_[A-Za-z0-9_]+$/.test(session)) {
    const token = await findTokenBySession(session);
    const order = token && (await getOrder(token));
    return new Response(JSON.stringify(order ? { token, number: order.number } : { pending: true }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  const token = params.get("t");
  const order = await getOrder(token);
  if (!order) {
    return new Response(JSON.stringify({ error: "Encomenda não encontrada" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response(JSON.stringify(publicOrder(order)), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
};
