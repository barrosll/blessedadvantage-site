// Catálogo guardado no Netlify Blobs. Enquanto nada for guardado pelo /admin,
// usa o products.json do repositório como ponto de partida.
import { getStore } from "@netlify/blobs";
import seed from "../../products.json";

const KEY = "catalog";

export function catalogStore() {
  return getStore({ name: "loja", consistency: "strong" });
}

export function imageStore() {
  return getStore("imagens");
}

export async function loadCatalog() {
  const saved = await catalogStore().get(KEY, { type: "json" });
  return saved || seed;
}

export async function saveCatalog(catalog) {
  await catalogStore().setJSON(KEY, catalog);
}

// Só o que os clientes podem ver
export function publicCatalog(catalog) {
  return {
    shipping: catalog.shipping,
    products: catalog.products.filter((p) => p.visible && p.options.length > 0)
  };
}

const text = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const cents = (v) => Math.round(Number(v));

// Valida e limpa o que vem do /admin antes de guardar
export function sanitizeCatalog(input) {
  if (!input || !Array.isArray(input.products)) throw new Error("Catálogo inválido");
  if (input.products.length > 500) throw new Error("Demasiados produtos");

  const s = input.shipping || {};
  const shipping = {
    label: text(s.label, 80) || "CTT · entrega ao domicílio",
    price: cents(s.price),
    freeFrom: s.freeFrom ? cents(s.freeFrom) : 0,
    days: [Math.max(1, cents(s.days && s.days[0]) || 2), Math.max(1, cents(s.days && s.days[1]) || 4)]
  };
  if (!(shipping.price >= 0 && shipping.price <= 10000)) throw new Error("Preço de envio inválido");
  if (!(shipping.freeFrom >= 0)) throw new Error("Valor de envio grátis inválido");

  const ids = new Set();
  const products = input.products.map((p, i) => {
    const id = text(p.id, 60).toLowerCase();
    const title = text(p.title, 120);
    if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw new Error(`Produto ${i + 1}: identificador inválido`);
    if (!title) throw new Error(`Produto ${i + 1}: falta o título`);
    ids.add(id);

    const image = text(p.image, 200);
    if (image && !/^(\/img\/[a-z0-9-]+|images\/[\w.-]+)$/i.test(image)) throw new Error(`"${title}": imagem inválida`);

    const optionIds = new Set();
    const options = (Array.isArray(p.options) ? p.options : []).slice(0, 12).map((o) => {
      const opt = {
        id: text(o.id, 40).toLowerCase(),
        label: text(o.label, 80),
        price: cents(o.price),
        weight: Math.round(Number(o.weight) * 1000) / 1000 || 0.3
      };
      if (!/^[a-z0-9-]+$/.test(opt.id) || optionIds.has(opt.id)) throw new Error(`"${title}": opção inválida`);
      if (!opt.label) throw new Error(`"${title}": falta o nome de um tamanho`);
      if (!(opt.price >= 50 && opt.price <= 1000000)) throw new Error(`"${title}": preço inválido em "${opt.label}"`);
      if (!(opt.weight > 0 && opt.weight <= 30)) throw new Error(`"${title}": peso inválido em "${opt.label}"`);
      optionIds.add(opt.id);
      return opt;
    });
    if (p.visible && options.length === 0) throw new Error(`"${title}": precisa de pelo menos um tamanho para estar visível`);

    return { id, title, visible: Boolean(p.visible), image, description: text(p.description, 2000), options };
  });

  return { shipping, products };
}
