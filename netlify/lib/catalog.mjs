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
    shippingMethods: normalizeMethods(catalog),
    sender: catalog.sender || {},
    products: catalog.products.map(normalizeProduct)
  };
}

// Métodos de envio. Catálogos antigos só tinham "shipping" (um preço único CTT):
// nesse caso cria-se o método "CTT · entrega em casa" com os mesmos valores.
function normalizeMethods(catalog) {
  if (Array.isArray(catalog.shippingMethods) && catalog.shippingMethods.length) return catalog.shippingMethods;
  const s = catalog.shipping || {};
  return [{
    id: "ctt-casa", name: s.label || "CTT · entrega em casa", carrier: "ctt", sendcloudCode: "",
    price: s.price == null ? 450 : s.price, freeFrom: s.freeFrom || 0, days: s.days || [2, 4],
    requiresServicePoint: false, enabled: true
  }];
}

// Método de envio ativo e com preço definido (ou null)
export function findMethod(catalog, id) {
  return normalizeMethods(catalog).find((m) => m.id === id && m.enabled && m.price != null) || null;
}

// Preço dos portes para o cliente (grátis a partir de X € — a expedição é criada na mesma)
export function shippingPrice(method, subtotal) {
  return method.freeFrom > 0 && subtotal >= method.freeFrom ? 0 : method.price;
}

export async function saveCatalog(catalog) {
  await catalogStore().setJSON(KEY, catalog);
}

// Só o que os clientes podem ver. Produtos sem variações aparecem como "Em breve"
// e não podem ser comprados (o checkout exige uma variação com preço).
export function publicCatalog(catalog) {
  return {
    shipping: { productionDays: (catalog.shipping && catalog.shipping.productionDays) || [3, 5] },
    // Só o necessário para o cliente escolher (sem códigos internos da Sendcloud)
    shippingMethods: normalizeMethods(catalog)
      .filter((m) => m.enabled && m.price != null)
      .map(({ id, name, carrier, price, freeFrom, days, requiresServicePoint }) => ({ id, name, carrier, price, freeFrom, days, requiresServicePoint })),
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

  // Métodos de envio
  const methodIds = new Set();
  const methodsIn = Array.isArray(input.shippingMethods) && input.shippingMethods.length ? input.shippingMethods : normalizeMethods({ shipping });
  const shippingMethods = methodsIn.slice(0, 12).map((m, i) => {
    const method = {
      id: text(m.id, 40).toLowerCase() || `metodo-${i + 1}`,
      name: text(m.name, 60),
      carrier: text(m.carrier, 40).toLowerCase(),
      sendcloudCode: text(m.sendcloudCode, 120),
      price: m.price === "" || m.price == null ? null : cents(m.price),
      freeFrom: m.freeFrom ? cents(m.freeFrom) : 0,
      days: dayRange(m.days, [2, 4], 1),
      requiresServicePoint: Boolean(m.requiresServicePoint),
      enabled: Boolean(m.enabled)
    };
    const label = method.name || `Método ${i + 1}`;
    if (!/^[a-z0-9-]+$/.test(method.id) || methodIds.has(method.id)) throw new Error(`${label}: identificador inválido`);
    if (!method.name) throw new Error(`Método ${i + 1}: falta o nome`);
    if (method.price != null && !(method.price >= 0 && method.price <= 10000)) throw new Error(`${label}: preço inválido`);
    if (method.enabled && method.price == null) throw new Error(`${label}: define o preço antes de ativar`);
    if (method.enabled && method.requiresServicePoint && !method.carrier) throw new Error(`${label}: indica a transportadora (para procurar pontos de recolha)`);
    if (!(method.freeFrom >= 0)) throw new Error(`${label}: valor de envio grátis inválido`);
    methodIds.add(method.id);
    return method;
  });
  if (!shippingMethods.some((m) => m.enabled)) throw new Error("Tem de existir pelo menos um método de envio ativo");

  // Morada do remetente (usada nas etiquetas da Sendcloud)
  const sIn = input.sender || {};
  const sender = {
    name: text(sIn.name, 80), street: text(sIn.street, 120), postalCode: text(sIn.postalCode, 12),
    city: text(sIn.city, 60), phone: text(sIn.phone, 30), email: text(sIn.email, 120)
  };
  if (sender.postalCode && !/^\d{4}-\d{3}$/.test(sender.postalCode)) throw new Error("Código postal do remetente inválido (formato 1234-567)");

  return { shipping, shippingMethods, sender, categories, site, products };
}
