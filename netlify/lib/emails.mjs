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

// Linha do tempo (igual à da página "A minha encomenda").
// Entrega em casa não mostra "Encomenda preparada" nem "Disponível para recolha".
const RANK = { paid: 0, production: 1, ready_to_ship: 2, shipped: 3, in_transit: 4, ready_for_pickup: 5, delivered: 6 };
export function timelineSteps(order) {
  const steps = order.servicePoint
    ? [["paid", "Pagamento confirmado"], ["production", "Em produção"], ["ready_to_ship", "Encomenda preparada"], ["shipped", "Enviada"],
       ["in_transit", "Em trânsito"], ["ready_for_pickup", "Disponível para recolha"], ["delivered", "Entregue"]]
    : [["paid", "Pagamento confirmado"], ["production", "Em produção"], ["shipped", "Enviada"], ["in_transit", "Em trânsito"], ["delivered", "Entregue"]];
  const rank = RANK[order.status] == null ? 0 : RANK[order.status];
  let current = 0;
  steps.forEach(([key], i) => { if (RANK[key] <= rank) current = i; });
  return { steps, current };
}

function progress(order) {
  const { steps, current } = timelineSteps(order);
  const cells = steps.map(([, text], i) => {
    const done = i <= current;
    return `<td align="center" valign="top" style="padding:0 2px;">
      <div style="width:24px;height:24px;line-height:24px;margin:0 auto 6px;border-radius:12px;background:${done ? C.lime : C.line};color:${C.dark};${FONT}font-size:12px;font-weight:700;">${done ? "✓" : i + 1}</div>
      <div style="${FONT}font-size:11px;line-height:1.3;color:${done ? C.text : C.muted};font-weight:${i === current ? 700 : 400};">${text}</div>
    </td>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;table-layout:fixed;"><tr>${cells.join("")}</tr></table>`;
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
const h1 = (t) => `<h1 style="margin:0 0 14px;${FONT}font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-.5px;color:${C.text};">${t}</h1>`;
const para = (t) => `<p style="margin:0 0 22px;${FONT}font-size:15px;line-height:1.6;color:${C.muted};">${t}</p>`;
const box = (inner) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:${C.bg};"><tr><td style="padding:18px 20px;${FONT}font-size:14px;line-height:1.7;color:${C.text};">${inner}</td></tr></table>`;

// Bloco "Entrega": método e ponto de recolha (ou morada)
function deliveryBlock(order) {
  const sp = order.servicePoint;
  const a = order.address || {};
  const where = sp
    ? `<span style="color:${C.muted};">Ponto de recolha:</span><br><strong>${esc(sp.name)}</strong><br>${esc(sp.street)}<br>${esc(sp.postalCode)} ${esc(sp.city)}`
    : `${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? "<br>" + esc(a.line2) : ""}<br>${esc(a.postalCode)} ${esc(a.city)}`;
  return `${label("Entrega")}
    <p style="margin:0 0 6px;${FONT}font-size:14px;line-height:1.6;color:${C.text};"><strong>${esc(order.shippingMethodName || "CTT")}</strong></p>
    <p style="margin:0;${FONT}font-size:14px;line-height:1.6;color:${C.text};">${where}</p>`;
}

function trackingBox(order) {
  if (!order.trackingNumber) return "";
  return box(`Código de seguimento:<br><span style="${MONO}font-size:17px;font-weight:600;letter-spacing:1px;">${esc(order.trackingNumber)}</span>`);
}

function itemsTable(order) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${order.items.map((it) => `<tr>
      <td width="72" valign="top" style="padding:14px 14px 14px 0;border-bottom:1px solid ${C.line};">
        ${it.image ? `<img src="${esc(it.image)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border:0;background:${C.bg};">` : ""}</td>
      <td valign="top" style="padding:14px 0;border-bottom:1px solid ${C.line};${FONT}font-size:14px;line-height:1.5;color:${C.text};">
        <strong>${esc(it.title)}</strong><br>
        <span style="color:${C.muted};">${esc([it.details, "Qtd. " + it.qty].filter(Boolean).join(" · "))}</span>
        ${it.note ? `<br><span style="color:${C.muted};font-style:italic;">Personalização: “${esc(it.note)}”</span>` : ""}</td>
      <td valign="top" align="right" style="padding:14px 0 14px 12px;border-bottom:1px solid ${C.line};${FONT}font-size:14px;font-weight:600;color:${C.text};white-space:nowrap;">${euro(it.unitPrice * it.qty)}</td>
    </tr>`).join("")}</table>`;
}

function totalsTable(order) {
  const row = (k, v, strong) => `<tr><td style="padding:4px 0;${FONT}font-size:14px;color:${strong ? C.text : C.muted};${strong ? "font-weight:700;font-size:16px;" : ""}">${k}</td>
    <td align="right" style="padding:4px 0;${FONT}font-size:14px;color:${C.text};${strong ? "font-weight:700;font-size:16px;" : ""}">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
      ${row("Subtotal", euro(order.subtotal))}
      ${order.discount ? row("Desconto", "−" + euro(order.discount)) : ""}
      ${row("Portes", order.shipping ? euro(order.shipping) : "Grátis")}
      ${row("Total pago", euro(order.total), true)}
    </table>`;
}

/** Email 1 — Pagamento confirmado. */
export function orderConfirmationEmail(order, siteUrl, contact) {
  const eta = order.eta;
  const body = `
    ${label(`Encomenda #${esc(order.number)}`)}
    ${h1(`Obrigado, ${esc(order.firstName)}!`)}
    ${para("Recebemos o teu pagamento e a tua encomenda já está na fila da impressora. Cada peça é impressa por encomenda, camada a camada — vamos avisando-te a cada passo.")}
    ${progress(order)}
    ${box(`<strong>Entrega prevista: ${fmtDate(eta[0])} – ${fmtDate(eta[1])}</strong><br>
      <span style="color:${C.muted};">Produção: ${order.productionDays[0]}–${order.productionDays[1]} dias úteis · Transporte: ${order.shippingDays[0]}–${order.shippingDays[1]} dias úteis</span>`)}
    ${button(order.trackUrl, "Acompanhar encomenda")}
    <div style="height:18px;"></div>
    ${label("Resumo")}
    ${itemsTable(order)}
    ${totalsTable(order)}
    <div style="height:28px;"></div>
    ${deliveryBlock(order)}
    <p style="margin:28px 0 0;${FONT}font-size:13px;line-height:1.6;color:${C.muted};">Guarda este email como comprovativo. Se algum dado estiver errado, responde a este email o quanto antes — antes de a peça ir para a impressora ainda conseguimos ajustar.</p>`;
  return {
    subject: `Pagamento confirmado — Encomenda ${order.number}`,
    html: layout({ preheader: `Recebemos a tua encomenda. Entrega prevista entre ${fmtDate(eta[0])} e ${fmtDate(eta[1])}.`, body, siteUrl, contact })
  };
}

/** Email 2 — A caminho (enviada / em trânsito). */
export function orderShippedEmail(order, siteUrl, contact) {
  const body = `
    ${label(`Encomenda #${esc(order.number)}`)}
    ${h1(`Está a caminho, ${esc(order.firstName)}!`)}
    ${para("A tua encomenda foi verificada, embalada à mão e entregue à transportadora.")}
    ${progress(order)}
    ${trackingBox(order)}
    ${button(order.trackingUrl || order.trackUrl, "Acompanhar encomenda")}
    <div style="height:18px;"></div>
    ${deliveryBlock(order)}
    <p style="margin:28px 0 0;${FONT}font-size:13px;line-height:1.6;color:${C.muted};">Quando a receberes, adorávamos ver a peça no seu novo lugar — marca-nos ou responde com uma foto.</p>`;
  return {
    subject: `A tua encomenda ${order.number} está a caminho`,
    html: layout({ preheader: order.trackingNumber ? `Tracking: ${order.trackingNumber}` : "A tua encomenda foi enviada.", body, siteUrl, contact })
  };
}

/** Email 3 — Disponível para recolha (só ponto de recolha). */
export function orderPickupEmail(order, siteUrl, contact) {
  const sp = order.servicePoint || {};
  const body = `
    ${label(`Encomenda #${esc(order.number)}`)}
    ${h1("Já podes levantar a tua encomenda!")}
    ${para(`A tua encomenda chegou a <strong style="color:${C.text};">${esc(sp.name)}</strong>. Leva o código de seguimento para a levantar.`)}
    ${progress(order)}
    ${box(`<strong>${esc(sp.name)}</strong><br>${esc(sp.street)}<br>${esc(sp.postalCode)} ${esc(sp.city)}
      ${order.trackingNumber ? `<br><br><span style="color:${C.muted};">Código de seguimento:</span><br><span style="${MONO}font-size:17px;font-weight:600;letter-spacing:1px;">${esc(order.trackingNumber)}</span>` : ""}`)}
    ${button(order.trackUrl, "Acompanhar encomenda")}
    <p style="margin:20px 0 0;${FONT}font-size:13px;line-height:1.6;color:${C.muted};">Os pontos de recolha guardam as encomendas por tempo limitado — levanta-a o quanto antes.</p>`;
  return {
    subject: `A tua encomenda ${order.number} já pode ser levantada`,
    html: layout({ preheader: `Disponível em ${sp.name || "ponto de recolha"}.`, body, siteUrl, contact })
  };
}

/** Email 4 — Entregue. */
export function orderDeliveredEmail(order, siteUrl, contact) {
  const body = `
    ${label(`Encomenda #${esc(order.number)}`)}
    ${h1(`Entregue! Esperamos que gostes, ${esc(order.firstName)}.`)}
    ${para("A tua encomenda foi entregue. Se alguma coisa não estiver perfeita, responde a este email — resolvemos contigo.")}
    ${progress(order)}
    ${button(order.trackUrl, "Ver a minha encomenda")}
    <p style="margin:20px 0 0;${FONT}font-size:13px;line-height:1.6;color:${C.muted};">Adorávamos ver a peça no seu novo lugar — responde com uma foto.</p>`;
  return {
    subject: `A tua encomenda ${order.number} foi entregue`,
    html: layout({ preheader: "A tua encomenda foi entregue.", body, siteUrl, contact })
  };
}

/** Email para a loja — nova encomenda paga. */
export function adminNewOrderEmail(order, siteUrl) {
  const sp = order.servicePoint;
  const a = order.address || {};
  const tracking = order.trackingNumber
    ? esc(order.trackingNumber)
    : order.shippingStatus === "shipping_error" ? "⚠ ENVIO NÃO CRIADO — ver na gestão" : "ainda sem código";
  const body = `
    ${label("Nova encomenda paga")}
    ${h1(`${esc(order.number)} — ${euro(order.total)}`)}
    <p style="margin:0 0 18px;${FONT}font-size:14px;line-height:1.7;color:${C.text};">
      <strong>${esc(order.name)}</strong><br>${esc(order.email)} · ${esc(order.phone)}${order.taxId ? "<br>NIF " + esc(order.taxId) : ""}</p>
    ${itemsTable(order)}
    ${totalsTable(order)}
    <div style="height:20px;"></div>
    ${label("Transporte")}
    <p style="margin:0;${FONT}font-size:14px;line-height:1.7;color:${C.text};">
      ${esc(order.shippingMethodName || "—")}<br>
      ${sp ? `Ponto: ${esc(sp.name)} — ${esc(sp.street)}, ${esc(sp.postalCode)} ${esc(sp.city)}<br>` : ""}
      Morada: ${esc([a.line1, a.line2, a.postalCode, a.city].filter(Boolean).join(", "))}<br>
      Peso: ${esc(order.parcelWeight)} kg<br>
      Tracking: ${tracking}</p>
    ${button(`${siteUrl}/admin.html`, "Abrir gestão")}`;
  return {
    subject: `Nova encomenda paga — ${order.number}`,
    html: layout({ preheader: `${order.name} · ${euro(order.total)} · ${order.shippingMethodName || ""}`, body, siteUrl, contact: "" })
  };
}
