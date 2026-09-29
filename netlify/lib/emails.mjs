// Emails transacionais da Welabb (HTML compatível com Gmail, Outlook e Apple Mail:
// tabelas, estilos inline, largura máx. 600px).

const C = { bg: "#f4f4f4", card: "#ffffff", text: "#0d0d0d", muted: "#5c5c5c", line: "#e6e6e6", lime: "#d4e000", green: "#84cc00", dark: "#0a0a0a" };
const FONT = "font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;";
const MONO = "font-family:'JetBrains Mono',Consolas,Menlo,monospace;";

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (cents) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);

// Soma dias úteis (sem sábados e domingos)
export function addBusinessDays(date, days) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}
export const fmtDate = (d) => new Intl.DateTimeFormat("pt-PT", { weekday: "short", day: "numeric", month: "long" }).format(new Date(d));

// Janela de entrega prevista [mais cedo, mais tarde] a partir da data do pagamento
export function computeEta(paidAt, productionDays, shippingDays) {
  return [
    addBusinessDays(paidAt, productionDays[0] + shippingDays[0]).toISOString(),
    addBusinessDays(paidAt, productionDays[1] + shippingDays[1]).toISOString()
  ];
}

// Etapas mostradas no email e na página da encomenda
const STEPS = ["Paga", "Em produção", "Enviada", "Entregue"];

function progress(current) {
  const cells = STEPS.map((label, i) => {
    const done = i <= current;
    return `<td align="center" style="padding:0 4px;">
      <div style="width:28px;height:28px;line-height:28px;margin:0 auto 6px;border-radius:14px;background:${done ? C.lime : C.line};color:${C.dark};${FONT}font-size:13px;font-weight:700;">${done ? "✓" : i + 1}</div>
      <div style="${FONT}font-size:12px;color:${done ? C.text : C.muted};font-weight:${i === current ? 700 : 400};">${label}</div>
    </td>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr>${cells.join("")}</tr></table>`;
}

function layout({ preheader, body, siteUrl, contact }) {
  return `<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Welabb</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
    <tr><td style="padding:0 8px 20px;"><a href="${siteUrl}"><img src="${siteUrl}/images/welabb-logo.png" alt="Welabb" width="130" style="display:block;width:130px;height:auto;border:0;"></a></td></tr>
    <tr><td style="background:${C.card};padding:36px 32px;">${body}</td></tr>
    <tr><td style="padding:24px 8px;${FONT}font-size:12px;line-height:1.6;color:${C.muted};">
      Welabb · Impressão 3D feita em Portugal<br>
      Dúvidas? Responde a este email${contact ? ` ou escreve para <a href="mailto:${esc(contact)}" style="color:${C.muted};">${esc(contact)}</a>` : ""}.<br>
      Recebeste este email porque fizeste uma encomenda em <a href="${siteUrl}" style="color:${C.muted};">${esc(siteUrl.replace(/^https?:\/\//, ""))}</a>.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const label = (t) => `<div style="${MONO}font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.muted};margin:0 0 10px;">■ ${t}</div>`;
const button = (href, text) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr><td style="background:${C.dark};">
  <a href="${href}" style="display:inline-block;padding:15px 28px;${FONT}font-size:14px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;text-decoration:none;">${text}</a></td></tr></table>`;

/**
 * Email "Obrigado pela tua encomenda".
 * order = { number, firstName, items:[{title, details, note, qty, unitPrice, image}], subtotal, shipping, discount, total,
 *           address:{name, line1, line2, postalCode, city}, paidAt, productionDays:[min,max], shippingDays:[min,max], trackUrl }
 */
export function orderConfirmationEmail(order, siteUrl, contact) {
  const eta = order.eta;

  const items = order.items.map((it) => `<tr>
      <td width="72" valign="top" style="padding:14px 14px 14px 0;border-bottom:1px solid ${C.line};">
        ${it.image ? `<img src="${esc(it.image)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border:0;background:${C.bg};">` : ""}</td>
      <td valign="top" style="padding:14px 0;border-bottom:1px solid ${C.line};${FONT}font-size:14px;line-height:1.5;color:${C.text};">
        <strong>${esc(it.title)}</strong><br>
        <span style="color:${C.muted};">${esc([it.details, "Qtd. " + it.qty].filter(Boolean).join(" · "))}</span>
        ${it.note ? `<br><span style="color:${C.muted};font-style:italic;">Nota: “${esc(it.note)}”</span>` : ""}</td>
      <td valign="top" align="right" style="padding:14px 0 14px 12px;border-bottom:1px solid ${C.line};${FONT}font-size:14px;font-weight:600;color:${C.text};white-space:nowrap;">${euro(it.unitPrice * it.qty)}</td>
    </tr>`).join("");

  const row = (k, v, strong) => `<tr><td style="padding:4px 0;${FONT}font-size:14px;color:${strong ? C.text : C.muted};${strong ? "font-weight:700;font-size:16px;" : ""}">${k}</td>
    <td align="right" style="padding:4px 0;${FONT}font-size:14px;color:${C.text};${strong ? "font-weight:700;font-size:16px;" : ""}">${v}</td></tr>`;

  const a = order.address;
  const body = `
    ${label(`Encomenda #${esc(order.number)}`)}
    <h1 style="margin:0 0 14px;${FONT}font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-.5px;color:${C.text};">Obrigado, ${esc(order.firstName)}!</h1>
    <p style="margin:0 0 22px;${FONT}font-size:15px;line-height:1.6;color:${C.muted};">Recebemos o teu pagamento e a tua encomenda já está na fila da impressora. Cada peça é impressa por encomenda, camada a camada — vamos avisando-te a cada passo.</p>

    ${progress(0)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:${C.bg};"><tr><td style="padding:18px 20px;${FONT}font-size:14px;line-height:1.6;color:${C.text};">
      <strong>Entrega prevista: ${fmtDate(eta[0])} – ${fmtDate(eta[1])}</strong><br>
      <span style="color:${C.muted};">Produção: ${order.productionDays[0]}–${order.productionDays[1]} dias úteis · Envio CTT: ${order.shippingDays[0]}–${order.shippingDays[1]} dias úteis</span>
    </td></tr></table>

    ${button(order.trackUrl, "Acompanhar encomenda")}

    <div style="height:18px;"></div>
    ${label("Resumo")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
      ${row("Subtotal", euro(order.subtotal))}
      ${order.discount ? row("Desconto", "−" + euro(order.discount)) : ""}
      ${row("Envio CTT", order.shipping ? euro(order.shipping) : "Grátis")}
      ${row("Total pago", euro(order.total), true)}
    </table>

    <div style="height:28px;"></div>
    ${label("Enviamos para")}
    <p style="margin:0;${FONT}font-size:14px;line-height:1.6;color:${C.text};">${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? "<br>" + esc(a.line2) : ""}<br>${esc(a.postalCode)} ${esc(a.city)}</p>

    <p style="margin:28px 0 0;${FONT}font-size:13px;line-height:1.6;color:${C.muted};">Guarda este email como comprovativo. Se algum dado estiver errado, responde a este email o quanto antes — antes de a peça ir para a impressora ainda conseguimos ajustar.</p>`;

  return {
    subject: `Encomenda #${order.number} confirmada — obrigado, ${order.firstName}!`,
    html: layout({ preheader: `Recebemos a tua encomenda. Entrega prevista entre ${fmtDate(eta[0])} e ${fmtDate(eta[1])}.`, body, siteUrl, contact })
  };
}

/** Email "A tua encomenda foi enviada" (com código CTT). */
export function orderShippedEmail(order, siteUrl, contact) {
  const t = order.tracking || {};
  const body = `
    ${label(`Encomenda #${esc(order.number)}`)}
    <h1 style="margin:0 0 14px;${FONT}font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-.5px;color:${C.text};">Está a caminho, ${esc(order.firstName)}!</h1>
    <p style="margin:0 0 22px;${FONT}font-size:15px;line-height:1.6;color:${C.muted};">A tua encomenda saiu da impressora, foi verificada e embalada à mão, e já foi entregue aos CTT.</p>

    ${progress(2)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:${C.bg};"><tr><td style="padding:18px 20px;${FONT}font-size:14px;line-height:1.7;color:${C.text};">
      ${t.number ? `Código de seguimento CTT:<br><span style="${MONO}font-size:17px;font-weight:600;letter-spacing:1px;">${esc(t.number)}</span><br>` : ""}
      <span style="color:${C.muted};">Entrega normalmente em ${(order.shippingDays || [2, 4]).join(" a ")} dias úteis.</span>
    </td></tr></table>

    ${t.url ? button(t.url, "Seguir nos CTT") : ""}
    <p style="margin:8px 0 0;${FONT}font-size:14px;"><a href="${order.trackUrl}" style="color:${C.text};">Ver a minha encomenda</a></p>

    <p style="margin:28px 0 0;${FONT}font-size:13px;line-height:1.6;color:${C.muted};">Quando a receberes, adorávamos ver a peça no seu novo lugar — marca-nos ou responde com uma foto.</p>`;

  return {
    subject: `A tua encomenda #${order.number} está a caminho`,
    html: layout({ preheader: t.number ? `Código CTT: ${t.number}` : "A tua encomenda foi enviada.", body, siteUrl, contact })
  };
}
