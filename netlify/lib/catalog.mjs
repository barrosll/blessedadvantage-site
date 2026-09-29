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
  const catalog = (await catalogStore().get(KEY, { type: "json" })) || seed;
  return {
    ...catalog,
    categories: catalog.categories || seed.categories,
    site: catalog.site || {},
    products: catalog.products.map(normalizeProduct)
  };
}

export async function saveCatalog(catalog) {
  await catalogStore().setJSON(KEY, catalog);
}

// Só o que os clientes podem ver. Produtos sem variações aparecem como "Em breve"
// e não podem ser comprados (o checkout exige uma variação com preço).
export function publicCatalog(catalog) {
  return {
    shipping: catalog.shipping,
    categories: catalog.categories || seed.categories,
    site: catalog.site || {},
    products: catalog.products.filter((p) => p.visible).map(normalizeProduct)
  };
}

// Completa produtos de versões antigas do catálogo
// (uma só foto em "image"; sem cores nem opção de personalizado)
function normalizeProduct(p) {
  const { image, ...rest } = p;
  return {
    ...rest,
    images: Array.isArray(p.images) ? p.images : image ? [image] : [],
    colors: Array.isArray(p.colors) ? p.colors : [],
    custom: Boolean(p.custom)
  };
}

export const CUSTOM_COLOR = "personalizado";
export const MAX_NOTE = 300;

const IMAGE_PATH = /^(\/img\/[a-z0-9-]+|images\/[\w-]+(\/[\w-]+)*\.(jpe?g|png|webp|svg))$/i;
const MAX_IMAGES = 12;

// Intervalo de dias [mín, máx] válido (aceita 0 quando min=0), com mín ≤ máx
function dayRange(v, fallback, min) {
  const n = (x, d) => (x === "" || x == null || !Number.isFinite(Number(x)) ? d : Math.min(60, Math.max(min, Math.round(Number(x)))));
  const a = n(v && v[0], fallback[0]);
  const b = n(v && v[1], fallback[1]);
  return [Math.min(a, b), Math.max(a, b)];
}

const text = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const cents = (v) => Math.round(Number(v));

// Valida e limpa o que vem do /admin antes de guardar
export function sanitizeCatalog(input) {
  if (!input || !Array.isArray(input.products)) throw new Error("Catálogo inválido");
  if (input.products.length > 500) throw new Error("Demasiados produtos");
  input = { ...input, products: input.products.map(normalizeProduct) };

  const s = input.shipping || {};
  const shipping = {
    label: text(s.label, 80) || "CTT · entrega ao domicílio",
    price: cents(s.price),
    freeFrom: s.freeFrom ? cents(s.freeFrom) : 0,
    days: [Math.max(1, cents(s.days && s.days[0]) || 2), Math.max(1, cents(s.days && s.days[1]) || 4)],
    productionDays: dayRange(s.productionDays, [3, 5], 0)
  };
  shipping.days = dayRange(shipping.days, [2, 4], 1);
  if (!(shipping.price >= 0 && shipping.price <= 10000)) throw new Error("Preço de envio inválido");
  if (!(shipping.freeFrom >= 0)) throw new Error("Valor de envio grátis inválido");

  const categoryIds = new Set();
  const categories = (Array.isArray(input.categories) ? input.categories : seed.categories).slice(0, 20).map((c) => {
    const cat = { id: text(c.id, 40).toLowerCase(), name: text(c.name, 60) };
    if (!/^[a-z0-9-]+$/.test(cat.id) || categoryIds.has(cat.id) || !cat.name) throw new Error("Categoria inválida");
    categoryIds.add(cat.id);
    return cat;
  });

  const ids = new Set();
  const products = input.products.map((p, i) => {
    const id = text(p.id, 60).toLowerCase();
    const title = text(p.title, 120);
    const name = title || `Produto ${i + 1}`; // para as mensagens de erro
    if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw new Error(`${name}: identificador inválido`);
    ids.add(id);

    const images = (Array.isArray(p.images) ? p.images : []).map((v) => text(v, 200)).filter(Boolean);
    if (images.length > MAX_IMAGES) throw new Error(`${name}: máximo de ${MAX_IMAGES} fotos`);
    if (images.some((v) => !IMAGE_PATH.test(v))) throw new Error(`${name}: foto inválida`);

    const optionIds = new Set();
    const options = (Array.isArray(p.options) ? p.options : []).slice(0, 12).map((o) => {
      const opt = {
        id: text(o.id, 40).toLowerCase(),
        label: text(o.label, 80),
        price: cents(o.price),
        weight: Math.round(Number(o.weight) * 1000) / 1000 || 0.3
      };
      if (!/^[a-z0-9-]+$/.test(opt.id) || optionIds.has(opt.id)) throw new Error(`${name}: variação inválida`);
      if (!opt.label) throw new Error(`${name}: falta o nome de uma variação`);
      if (!(opt.price >= 50 && opt.price <= 1000000)) throw new Error(`${name}: preço inválido em "${opt.label}"`);
      if (!(opt.weight > 0 && opt.weight <= 30)) throw new Error(`${name}: peso inválido em "${opt.label}"`);
      optionIds.add(opt.id);
      return opt;
    });
    const category = categoryIds.has(p.category) ? p.category : "";

    const colorNames = new Set();
    const colors = (Array.isArray(p.colors) ? p.colors : []).slice(0, 20).map((c) => {
      const color = { name: text(c.name, 40), hex: text(c.hex, 7).toLowerCase() };
      if (!color.name) throw new Error(`${name}: falta o nome de uma cor`);
      if (color.name.toLowerCase() === CUSTOM_COLOR) throw new Error(`${name}: “Personalizado” é criado pela opção própria, não como cor`);
      if (colorNames.has(color.name.toLowerCase())) throw new Error(`${name}: cor repetida (“${color.name}”)`);
      if (color.hex && !/^#[0-9a-f]{6}$/.test(color.hex)) throw new Error(`${name}: código de cor inválido em “${color.name}”`);
      colorNames.add(color.name.toLowerCase());
      return color;
    });

    return {
      id, title, category, visible: Boolean(p.visible), images,
      description: text(p.description, 2000), options, colors, custom: Boolean(p.custom)
    };
  });

  // Imagens do site (hero e processo); vazio = imagem original
  const siteIn = input.site || {};
  const site = {};
  for (const key of ["heroImage", "processImage"]) {
    const v = text(siteIn[key], 200);
    if (v && !IMAGE_PATH.test(v)) throw new Error("Imagem do site inválida");
    if (v) site[key] = v;
  }

  return { shipping, categories, site, products };
}
