// Área de gestão. TODAS as rotas exigem a password ADMIN_PASSWORD (validada aqui, no servidor).
import { loadCatalog, saveCatalog, sanitizeCatalog, imageStore } from "../lib/catalog.mjs";
import { listOrders, getOrder, updateOrder, applyStatus, STATUSES } from "../lib/orders.mjs";
import * as sendcloud from "../lib/sendcloud.mjs";
import {
  ensureShipment, hasShipment, sendOrderEmail, notifyForStatus, refreshTracking, EMAIL_TYPES, siteUrlFrom
} from "../lib/fulfillment.mjs";

export const config = {
  path: [
    "/api/admin/catalog", "/api/admin/upload", "/api/admin/login", "/api/admin/orders", "/api/admin/order",
    "/api/admin/label", "/api/admin/labels", "/api/admin/tracking-refresh", "/api/admin/sendcloud-options"
  ]
};

// Link do CTT para um código de seguimento (envios registados à mão, sem Sendcloud)
const cttUrl = (code) => `https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects=${encodeURIComponent(code)}`;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BULK = 20; // etiquetas por pedido (limite da Sendcloud); o browser envia lotes sucessivos
const CONCURRENCY = 5;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Compara as passwords sem revelar pelo tempo de resposta onde diferem
async function isAuthorized(req) {
  const password = Netlify.env.get("ADMIN_PASSWORD");
  if (!password || password.length < 8) return false;
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [a, b] = await Promise.all([sha256(given), sha256(password)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export default async (req) => {
  const path = new URL(req.url).pathname;

  if (!(await isAuthorized(req))) {
    // Pequena pausa para dificultar tentativas repetidas de adivinhar a password
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "Password errada" }, 401);
  }

  if (path === "/api/admin/login") return json({ ok: true, sendcloud: sendcloud.isConfigured(), sendcloudMock: sendcloud.isMock() });

  if (path === "/api/admin/catalog") {
    if (req.method === "GET") return json(await loadCatalog());
    if (req.method === "PUT") {
      let clean;
      try {
        clean = sanitizeCatalog(await req.json());
      } catch (err) {
        return json({ error: err.message }, 400);
      }
      await saveCatalog(clean);
      return json(clean);
    }
  }

  if (path === "/api/admin/upload" && req.method === "POST") {
    const type = (req.headers.get("content-type") || "").split(";")[0];
    if (!IMAGE_TYPES.includes(type)) return json({ error: "Use JPG, PNG ou WebP" }, 400);
    const data = await req.arrayBuffer();
    if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) return json({ error: "Imagem demasiado grande (máx. 5 MB)" }, 400);

    const key = crypto.randomUUID();
    await imageStore().set(key, data, { metadata: { type } });
    return json({ url: `/img/${key}` });
  }

  if (path === "/api/admin/orders" && req.method === "GET") {
    return json(await listOrders());
  }

  // Opções de envio disponíveis na conta Sendcloud (para configurar os métodos na gestão)
  if (path === "/api/admin/sendcloud-options" && req.method === "GET") {
    if (!sendcloud.isConfigured()) return json({ error: sendcloud.NOT_CONFIGURED }, 400);
    try {
      const catalog = await loadCatalog();
      return json({ options: await sendcloud.getShippingMethods({ fromPostalCode: catalog.sender && catalog.sender.postalCode }) });
    } catch (err) {
      return json({ error: err.message }, 502);
    }
  }

  // Etiqueta de uma encomenda (PDF A6 da Sendcloud)
  if (path === "/api/admin/label" && req.method === "GET") {
    const order = await getOrder(new URL(req.url).searchParams.get("token"));
    if (!order) return json({ error: "Encomenda não encontrada" }, 404);
    if (!order.sendcloudParcelId) return json({ error: "Esta encomenda ainda não tem envio criado na Sendcloud" }, 400);
    try {
      const pdf = await sendcloud.getLabel(order.sendcloudParcelId);
      await updateOrder(order.token, (o) => { o.labelPrintedAt = new Date().toISOString(); });
      return new Response(pdf, {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="etiqueta-${order.number}.pdf"`, "Cache-Control": "no-store" }
      });
    } catch (err) {
      return json({ error: err.message }, 502);
    }
  }

  // Etiquetas em lote: até 20 encomendas por pedido → um PDF (endpoint de lote da Sendcloud).
  // Se o lote falhar, tenta cada etiqueta individualmente (5 de cada vez) para isolar as que falham.
  if (path === "/api/admin/labels" && req.method === "POST") {
    const body = await readJson(req);
    const tokens = Array.isArray(body && body.tokens) ? [...new Set(body.tokens)].slice(0, MAX_BULK) : [];
    if (!tokens.length) return json({ error: "Nenhuma encomenda selecionada" }, 400);

    const orders = await Promise.all(tokens.map(getOrder));
    const failed = [];
    const ready = [];
    orders.forEach((o, i) => {
      if (!o) failed.push({ token: tokens[i], number: "?", reason: "Encomenda não encontrada" });
      else if (!o.sendcloudParcelId) failed.push({ token: o.token, number: o.number, reason: "Envio ainda não criado" });
      else ready.push(o);
    });

    const pdfs = [];
    const ok = [];
    if (ready.length) {
      try {
        pdfs.push(toBase64(await sendcloud.getLabels(ready.map((o) => o.sendcloudParcelId))));
        ok.push(...ready.map((o) => o.number));
      } catch (batchErr) {
        console.error("Etiquetas em lote:", batchErr.message);
        const results = await sendcloud.mapLimit(ready, CONCURRENCY, (o) => sendcloud.getLabel(o.sendcloudParcelId));
        results.forEach((r, i) => {
          if (r.ok) { pdfs.push(toBase64(r.value)); ok.push(ready[i].number); }
          else failed.push({ token: ready[i].token, number: ready[i].number, reason: r.error.message });
        });
      }
      const printedAt = new Date().toISOString();
      await sendcloud.mapLimit(ready.filter((o) => ok.includes(o.number)), CONCURRENCY, (o) =>
        updateOrder(o.token, (x) => { x.labelPrintedAt = printedAt; }));
    }
    return json({ pdfs, ok, failed });
  }

  // Atualizar tracking (consulta à Sendcloud) — várias encomendas, 5 de cada vez
  if (path === "/api/admin/tracking-refresh" && req.method === "POST") {
    if (!sendcloud.isConfigured()) return json({ error: sendcloud.NOT_CONFIGURED }, 400);
    const body = await readJson(req);
    const tokens = Array.isArray(body && body.tokens) ? [...new Set(body.tokens)].slice(0, 100) : [];
    const siteUrl = siteUrlFrom(req);
    const results = await sendcloud.mapLimit(tokens, CONCURRENCY, (t) => refreshTracking(t, siteUrl));
    const failed = results.map((r, i) => (r.ok ? null : { token: tokens[i], reason: r.error.message })).filter(Boolean);
    return json({ updated: results.filter((r) => r.ok && r.value.changed).length, checked: tokens.length, failed });
  }

  // Ações numa encomenda
  if (path === "/api/admin/order" && req.method === "POST") {
    const body = await readJson(req);
    if (!body) return json({ error: "Pedido inválido" }, 400);
    const order = await getOrder(body.token);
    if (!order) return json({ error: "Encomenda não encontrada" }, 404);
    const siteUrl = siteUrlFrom(req);
    const done = async (message) => json({ order: await getOrder(order.token), message });

    // Reenviar um email (manual: envia mesmo que já tenha sido enviado antes)
    if (body.action === "resend") {
      const type = body.type || "confirmation";
      if (!EMAIL_TYPES.includes(type)) return json({ error: "Tipo de email inválido" }, 400);
      const r = await sendOrderEmail(order.token, type, siteUrl, { force: true });
      if (r.error) return json({ error: "Falha ao enviar: " + r.error }, 502);
      if (r.skipped) return json({ error: "Email não enviado: " + r.skipped }, 400);
      return done("Email enviado");
    }

    // Recriar envio — só se realmente não existir nenhum
    if (body.action === "retry-shipment") {
      if (hasShipment(order)) return json({ error: "Esta encomenda já tem envio na Sendcloud — não foi criado outro." }, 409);
      const r = await ensureShipment(order.token);
      if (r.error) return json({ error: "Envio não criado: " + r.error, order: r.order }, 502);
      if (r.skipped) return json({ error: "Envio não criado: " + r.skipped, order: r.order }, 400);
      return done(r.reused ? "A Sendcloud já tinha este envio — foi associado à encomenda (sem duplicar)." : "Envio criado na Sendcloud");
    }

    if (body.action === "refresh-tracking") {
      try {
        const r = await refreshTracking(order.token, siteUrl);
        return done(r.skipped ? "Sem envio para consultar" : r.changed ? "Tracking atualizado" : "Sem alterações no tracking");
      } catch (err) {
        return json({ error: err.message }, 502);
      }
    }

    // Mudar estado / código de seguimento manual
    const status = String(body.status || order.status);
    if (!STATUSES.includes(status)) return json({ error: "Estado inválido" }, 400);
    const code = body.trackingNumber == null ? order.trackingNumber : String(body.trackingNumber).trim().toUpperCase().slice(0, 40);
    if (code && !/^[A-Z0-9]+$/.test(code)) return json({ error: "Código de seguimento inválido (só letras e números)" }, 400);
    if (["shipped", "in_transit"].includes(status) && !code && !hasShipment(order)) {
      return json({ error: "Para marcar como enviada sem Sendcloud, indica o código de seguimento" }, 400);
    }

    let cancelMsg = "";
    if (status === "cancelled" && order.status !== "cancelled" && order.sendcloudShipmentId) {
      // Cancela também o envio na Sendcloud quando a transportadora o permite. NÃO faz reembolso:
      // o reembolso é feito à parte, no painel da Stripe.
      try {
        await sendcloud.cancelParcel(order.sendcloudShipmentId);
        cancelMsg = " Envio cancelado na Sendcloud.";
      } catch (err) {
        cancelMsg = " Atenção: o envio na Sendcloud não foi cancelado (" + err.message + ").";
      }
    }

    await updateOrder(order.token, (o) => {
      if (code !== o.trackingNumber) {
        o.trackingNumber = code || "";
        o.trackingUrl = code ? (o.sendcloudParcelId ? o.trackingUrl : cttUrl(code)) : "";
      }
      if (status === "cancelled" && cancelMsg.includes("cancelado na")) o.shippingStatus = "cancelled";
      applyStatus(o, status, { force: true });
    });
    await notifyForStatus(order.token, siteUrl);
    return done("Encomenda atualizada." + cancelMsg + (status === "cancelled" ? " O reembolso (se aplicável) faz-se no painel da Stripe." : ""));
  }

  return json({ error: "Não encontrado" }, 404);
};
