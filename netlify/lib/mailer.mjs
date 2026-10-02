// Envio de emails pelo Resend (https://resend.com).
// Sem RESEND_API_KEY (ex.: em testes locais) o email não é enviado, só registado no log.
export async function sendEmail({ to, subject, html }) {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const from = Netlify.env.get("EMAIL_FROM") || "Welabb <encomendas@blessedadvantage.pt>";
  const replyTo = Netlify.env.get("EMAIL_REPLY_TO"); // caixa de email que lê (para as respostas dos clientes)

  // EMAIL_MOCK=1 (só dentro do netlify dev): não envia, guarda o email num Blob para testes
  if (Netlify.env.get("EMAIL_MOCK") === "1" && Netlify.env.get("NETLIFY_DEV") === "true") {
    const { getStore } = await import("@netlify/blobs");
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await getStore({ name: "emails-teste", consistency: "strong" }).setJSON(id, { to, subject, at: new Date().toISOString() });
    console.log(`[email simulado] Para: ${to} | ${subject}`);
    return { id, mock: true };
  }

  if (!apiKey) {
    console.log(`[email não enviado — falta RESEND_API_KEY] Para: ${to} | ${subject}`);
    return { skipped: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], ...(replyTo ? { reply_to: replyTo } : {}), subject, html })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || JSON.stringify(data)}`);
  console.log(`Email enviado para ${to}: ${subject}`);
  return data;
}
