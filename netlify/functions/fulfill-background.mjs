// Guia CTT + emails depois do pagamento (até 15 min numa background function). Lançada pelo webhook da Stripe.
import { fulfillOrder, fulfillKey } from "../lib/fulfillment.mjs";

export default async (req) => {
  const { token, siteUrl } = await req.json().catch(() => ({}));
  if (!token || !Netlify.env.get("STRIPE_WEBHOOK_SECRET") || req.headers.get("x-fulfill-key") !== (await fulfillKey(token))) return;
  try {
    await fulfillOrder(token, siteUrl || Netlify.env.get("URL"));
  } catch (err) {
    console.error("Pós-pagamento:", err.message);
  }
};
