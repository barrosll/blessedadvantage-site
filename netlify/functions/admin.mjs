// Área de gestão: ler/guardar o catálogo e carregar fotos. Protegida pela password ADMIN_PASSWORD.
import { loadCatalog, saveCatalog, sanitizeCatalog, imageStore } from "../lib/catalog.mjs";
import { listOrders, getOrder, saveOrder, STATUSES } from "../lib/orders.mjs";
import { orderConfirmationEmail, orderShippedEmail } from "../lib/emails.mjs";
import { sendEmail } from "../lib/mailer.mjs";

export const config = {
  path: ["/api/admin/catalog", "/api/admin/upload", "/api/admin/login", "/api/admin/orders", "/api/admin/order"]
};

// Link do CTT para um código de seguimento
const cttUrl = (code) => `https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects=${encodeURIComponent(code)}`;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

export default async (req) => {
  const path = new URL(req.url).pathname;

  if (!(await isAuthorized(req))) {
    // Pequena pausa para dificultar tentativas repetidas de adivinhar a password
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "Password errada" }, 401);
  }

  if (path === "/api/admin/login") return json({ ok: true });

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

  // Atualizar uma encomenda: estado, código CTT, reenviar email
  if (path === "/api/admin/order" && req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Pedido inválido" }, 400);
    }
    const order = await getOrder(body.token);
    if (!order) return json({ error: "Encomenda não encontrada" }, 404);
    const siteUrl = Netlify.env.get("URL") || new URL(req.url).origin;
    const contact = Netlify.env.get("EMAIL_REPLY_TO");

    if (body.action === "resend") {
      try {
        const sent = await sendEmail({ to: order.email, ...orderConfirmationEmail(order, siteUrl, contact) });
        if (sent.skipped) return json({ error: "Email não enviado: o Resend ainda não está configurado (RESEND_API_KEY)" }, 400);
        order.confirmationSentAt = new Date().toISOString();
        delete order.emailError;
        await saveOrder(order);
        return json({ order, message: "Email de confirmação reenviado" });
      } catch (err) {
        return json({ error: "Falha ao enviar email: " + err.message }, 502);
      }
    }

    const status = String(body.status || order.status);
    if (!STATUSES.includes(status)) return json({ error: "Estado inválido" }, 400);
    const code = String(body.trackingNumber == null ? (order.tracking && order.tracking.number) || "" : body.trackingNumber)
      .trim().toUpperCase().slice(0, 40);
    if (code && !/^[A-Z0-9]+$/.test(code)) return json({ error: "Código CTT inválido (só letras e números)" }, 400);
    if (status === "enviada" && !code) return json({ error: "Para marcar como enviada, indica o código CTT" }, 400);

    const becameShipped = status === "enviada" && order.status !== "enviada";
    if (status !== order.status) order.history = [...(order.history || []), { status, at: new Date().toISOString() }];
    order.status = status;
    order.tracking = code ? { number: code, url: (order.tracking && order.tracking.number === code && order.tracking.url) || cttUrl(code) } : null;

    let message = "Encomenda atualizada";
    if (becameShipped && body.notify !== false) {
      try {
        const sent = await sendEmail({ to: order.email, ...orderShippedEmail(order, siteUrl, contact) });
        if (sent.skipped) {
          message = "Marcada como enviada (email não enviado: o Resend ainda não está configurado)";
        } else {
          order.shippedEmailAt = new Date().toISOString();
          message = "Marcada como enviada — email com o código CTT enviado ao cliente";
        }
      } catch (err) {
        message = "Marcada como enviada, mas o email falhou: " + err.message;
      }
    }
    await saveOrder(order);
    return json({ order, message });
  }

  return json({ error: "Não encontrado" }, 404);
};
