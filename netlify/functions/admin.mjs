// Área de gestão: ler/guardar o catálogo e carregar fotos. Protegida pela password ADMIN_PASSWORD.
import { loadCatalog, saveCatalog, sanitizeCatalog, imageStore } from "../lib/catalog.mjs";

export const config = { path: ["/api/admin/catalog", "/api/admin/upload", "/api/admin/login"] };

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

  return json({ error: "Não encontrado" }, 404);
};
