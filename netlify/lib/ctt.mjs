// CTT Expresso — todas as chamadas aos web services SOAP passam por este módulo (só backend).
//
// Documentação: "SGEE - CTTX - WS Aplicacoes Proprias - Especificacao Tecnica V1.8", "EventosWS V2.0",
// "ReferenciasWS V1.0" (enviadas pela CTT a 01/11/2026). Serviços usados:
//   CTTShipmentProviderWS.CreateShipment     cria o envio e devolve a guia de transporte A4 (PDF base64)
//   Eventosws.GetEventosObjectos_V3          eventos de tracking
//   Referenciasws.ObterTodosPontosEntrega    lojas CTT e cacifos (pontos de entrega)
//
// Variáveis: CTT_AUTH_ID, CTT_USER_ID, CTT_CLIENT_ID, CTT_CONTRACT_ID, CTT_SUBPRODUCT
// (EMSF057.01 = Em Dois Dias, EMSF056.01 = Para Amanhã) e CTT_BASE_URL (por omissão o sandbox QA).
// Os serviços WCF exigem os elementos pela ordem do contrato (alfabética) — não reordenar.

const QA_BASE = "https://cttexpressows.qa.ctt.pt/CTTEWSPoolHTTPS";

const NS = {
  tempuri: "http://tempuri.org/",
  ws: "http://schemas.datacontract.org/2004/07/CTTExpressoWS",
  sp: "http://schemas.datacontract.org/2004/07/CTTExpressoWS.Models.ShipmentProvider",
  sep: "http://schemas.datacontract.org/2004/07/CTTExpressoWS.Models.ShipmentProvider.SEPs"
};

export class CttError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]);

function config() {
  const c = {
    base: (env("CTT_BASE_URL") || QA_BASE).replace(/\/$/, ""),
    authId: env("CTT_AUTH_ID"),
    userId: env("CTT_USER_ID"),
    clientId: env("CTT_CLIENT_ID"),
    contractId: env("CTT_CONTRACT_ID"),
    subProduct: env("CTT_SUBPRODUCT") || "EMSF057.01"
  };
  return c.authId && c.clientId && c.contractId ? c : null;
}

export const isConfigured = () => Boolean(config());
export const NOT_CONFIGURED =
  "CTT ainda não está configurado (faltam CTT_AUTH_ID, CTT_CLIENT_ID e CTT_CONTRACT_ID nas variáveis da Netlify).";

// ---------------------------------------------------------------------------------------------
// SOAP
// ---------------------------------------------------------------------------------------------
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Elemento XML; ignora valores null/undefined/"" para não enviar campos opcionais vazios. */
function el(prefix, name, content) {
  if (content == null || content === "") return "";
  const inner = Array.isArray(content) ? content.join("") : typeof content === "string" && content.startsWith("<") ? content : esc(content);
  return `<${prefix}:${name}>${inner}</${prefix}:${name}>`;
}

// Limite de espera: as functions da Netlify são cortadas aos ~10 s. Normalmente a CTT responde em ~1,5 s;
// se encravar, a encomenda fica com erro de envio (repetível na gestão) em vez de a função morrer a meio.
async function soap(service, action, body, { timeoutMs = 7000 } = {}) {
  const c = config();
  if (!c) throw new CttError(NOT_CONFIGURED, 503);
  const xmlns = Object.entries(NS).map(([p, u]) => `xmlns:${p}="${u}"`).join(" ");
  const envelope = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ${xmlns}><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
  let res, text;
  try {
    res = await fetch(`${c.base}/${service}.svc`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${action}"` },
      body: envelope,
      signal: AbortSignal.timeout(timeoutMs)
    });
    text = await res.text();
  } catch (err) {
    const msg = err.name === "TimeoutError" ? `sem resposta em ${timeoutMs / 1000} s` : err.message;
    throw new CttError("CTT indisponível: " + msg + ". Tenta novamente.", 503);
  }
  if (!res.ok) {
    const fault = tag(text, "faultstring") || text.slice(0, 300);
    throw new CttError(`CTT ${res.status}: ${fault}`, res.status, text);
  }
  return text;
}

// Leitura simples das respostas (sem parser XML nas functions): ignora prefixos de namespace.
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? decode(m[1]) : "";
}
function tags(xml, name) {
  const re = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g");
  return [...String(xml).matchAll(re)].map((m) => m[1]);
}
const errorsOf = (xml) => tags(xml, "ErrorData").map((e) => decode(tag(e, "Message") || "")).filter(Boolean);

// ---------------------------------------------------------------------------------------------
// Criação de envio (guia de transporte A4 em PDF)
// ---------------------------------------------------------------------------------------------
function splitPostalCode(pc) {
  const m = String(pc || "").match(/(\d{4})\s*-?\s*(\d{3})/);
  if (!m) throw new CttError(`Código postal inválido: "${pc}" (formato 0000-000).`, 400);
  return { cp4: m[1], cp3: m[2] };
}

function address(type, a) {
  const { cp4, cp3 } = splitPostalCode(a.postalCode);
  // Ordem do contrato: Address, City, ContactName, Country, Door, Email, Floor, MobilePhone, Name,
  // NonPTZipCode, NonPTZipCodeLocation, PTZipCode3, PTZipCode4, PTZipCodeLocation, Phone, Type
  return [
    el("sp", "Address", String(a.street).slice(0, 100)),
    el("sp", "City", String(a.city).slice(0, 50)),
    el("sp", "ContactName", a.contactName && String(a.contactName).slice(0, 60)),
    el("sp", "Country", "PT"),
    el("sp", "Email", a.email),
    el("sp", "MobilePhone", a.phone),
    el("sp", "Name", String(a.name).slice(0, 60)),
    el("sp", "PTZipCode3", cp3),
    el("sp", "PTZipCode4", cp4),
    el("sp", "PTZipCodeLocation", String(a.city).slice(0, 50)),
    el("sp", "Type", type)
  ].join("");
}

/**
 * Cria o envio na CTT para uma encomenda. Entrega em casa (1 tentativa, depois avisado na loja CTT)
 * ou num ponto CTT (order.servicePoint = { id, name, type: "PostOffice"|"ParcelLocker", street, postalCode, city }).
 * Devolve { trackingNumber, labelPdfBase64, labelFileName }.
 */
export const PRODUCTS = { "EMSF057.01": "Em 2 dias", "EMSF056.01": "Para amanhã" };

export async function createShipment(order, sender, { requestId = crypto.randomUUID() } = {}) {
  const c = config();
  if (!c) throw new CttError(NOT_CONFIGURED, 503);
  if (!sender || !sender.name || !sender.street || !sender.postalCode || !sender.city) {
    throw new CttError("Falta a morada do remetente (Gestão → Produtos e site → Envio).", 400);
  }
  const a = order.address || {};
  const point = order.servicePoint;
  // Sem nome a CTT rejeita o pedido inteiro (erro 500 de formato)
  const customer = { name: a.name || order.name || order.email || "Cliente", email: order.email, phone: order.phone };
  // Em pontos CTT, a morada do destinatário é a do ponto; nome e contactos são os do cliente.
  const receiver = point
    ? { ...customer, street: point.street, postalCode: point.postalCode, city: point.city, contactName: point.name }
    : { ...customer, street: [a.line1, a.line2].filter(Boolean).join(", "), postalCode: a.postalCode, city: a.city };

  const special = point
    ? el("sp", "SpecialService", [
        el("sp", "DeliveryPoint", [el("sep", "Code", point.id), el("sep", "Name", point.name), el("sep", "Type", point.type || "PostOffice")]),
        el("sp", "SpecialServiceType", "DeliveryPoint")
      ])
    : el("sp", "SpecialService", [
        el("sp", "MultipleHomeDelivery", [el("sep", "AttemptsNumber", 1), el("sep", "InNonDeliveryCase", "PostOfficeNotiffied")]),
        el("sp", "SpecialServiceType", "MultipleHomeDelivery")
      ]);

  const grams = Math.max(1, Math.round(Number(order.parcelWeight || 1) * 1000));
  const shipment = el("sp", "ShipmentCTT", [
    el("sp", "HasSenderInformation", "true"),
    el("sp", "ReceiverData", address("Receiver", receiver)),
    el("sp", "SenderData", address("Sender", { name: sender.name, street: sender.street, postalCode: sender.postalCode, city: sender.city, email: sender.email, phone: sender.phone })),
    el("sp", "ShipmentData", [
      el("sp", "ClientReference", String(order.number).slice(0, 21)),
      el("sp", "IsDevolution", "false"),
      el("sp", "Quantity", 1),
      el("sp", "Weight", grams)
    ]),
    el("sp", "SpecialServices", special)
  ]);

  const body = el("tempuri", "CreateShipment", el("tempuri", "Input", [
    el("ws", "AuthenticationID", c.authId),
    el("ws", "DeliveryNote", [
      el("sp", "ClientId", c.clientId),
      el("sp", "ContractId", c.contractId),
      el("sp", "DistributionChannelId", 99),
      el("sp", "ShipmentCTT", shipment),
      el("sp", "SubProductId", order.cttProduct || c.subProduct)
    ]),
    el("ws", "RequestID", requestId),
    el("ws", "UserID", c.userId)
  ]));

  const xml = await soap("CTTShipmentProviderWS", "http://tempuri.org/ICTTShipmentProviderWS/CreateShipment", body);
  const status = tag(xml, "Status");
  if (status !== "Success") {
    const errs = errorsOf(xml);
    throw new CttError(`CTT recusou o envio: ${errs.join(" | ") || status || "resposta inesperada"}`, 422, xml);
  }
  const out = tags(xml, "ShipmentDataOutput")[0] || "";
  const doc = tags(out, "DocumentData")[0] || "";
  return {
    trackingNumber: decode(tag(out, "FirstObject")),
    labelPdfBase64: tag(doc, "File").replace(/\s/g, ""),
    labelFileName: tag(doc, "FileName") || `${order.number}.pdf`,
    requestId
  };
}

// Guia de transporte guardada em Blobs (a CTT só a devolve no momento da criação)
const labelStore = async () => (await import("@netlify/blobs")).getStore({ name: "ctt-labels", consistency: "strong" });
export async function saveLabel(token, base64) {
  await (await labelStore()).set(token, Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)), { metadata: { type: "application/pdf" } });
}
export async function getLabel(token) {
  const data = await (await labelStore()).get(token, { type: "arrayBuffer" });
  return data ? new Uint8Array(data) : null;
}

// ---------------------------------------------------------------------------------------------
// Pontos de entrega (lojas CTT, postos CTT e cacifos). A lista completa tem ~4 MB: é descarregada
// no máximo uma vez por dia (função agendada às 8h + recarga se tiver mais de 26 h) e guardada
// compacta em Blobs. O tipo vem do 1.º dígito do PuP ID (indicação da CTT):
//   8 = Loja CTT, 9 = Posto CTT, 4 = Cacifo CTT 24H (2 = Phone House, inativos; 3 = Payshop, não usados)
// ---------------------------------------------------------------------------------------------
const POINT_KINDS = { 8: { kind: "Loja CTT", type: "PostOffice" }, 9: { kind: "Posto CTT", type: "PostOffice" }, 4: { kind: "Cacifo CTT 24H", type: "ParcelLocker" } };
const POINTS_KEY = "points";
const POINTS_MAX_AGE = 26 * 3600 * 1000;
const pointsStore = async () => (await import("@netlify/blobs")).getStore({ name: "ctt", consistency: "strong" });

export function parsePoints(xml) {
  const field = (rec, name) => decode(tag(rec, name)).trim();
  return tags(xml, "TBLPontosEntrega").map((rec) => {
    const id = field(rec, "PuP_x0020_ID");
    const k = POINT_KINDS[id[0]];
    if (!k || field(rec, "Country_x0020_Code") !== "PT") return null;
    const street = [field(rec, "street_x0020_name").replace(/,\s*$/, ""), field(rec, "Street_x0020_number")].filter(Boolean).join(" ");
    return {
      id, type: k.type, kind: k.kind, name: field(rec, "Display_x0020_Name"),
      street, postalCode: field(rec, "postalcode"), city: field(rec, "town"),
      lat: Number(field(rec, "Latitude")) || null, lng: Number(field(rec, "Longitude")) || null
    };
  }).filter((p) => p && p.name && /^\d{4}-\d{3}$/.test(p.postalCode));
}

export async function refreshPoints() {
  const c = config();
  if (!c) throw new CttError(NOT_CONFIGURED, 503);
  const xml = await soap("Referenciasws", "http://tempuri.org/IReferenciasWS/ObterTodosPontosEntrega",
    `<tempuri:ObterTodosPontosEntrega><tempuri:ID>${esc(c.authId)}</tempuri:ID></tempuri:ObterTodosPontosEntrega>`, { timeoutMs: 25000 });
  const points = parsePoints(xml);
  if (points.length < 50) throw new CttError(`Lista de pontos CTT incompleta (${points.length})`, 502);
  await (await pointsStore()).setJSON(POINTS_KEY, { updatedAt: new Date().toISOString(), points });
  return points;
}

async function allPoints() {
  const cached = await (await pointsStore()).get(POINTS_KEY, { type: "json" });
  if (cached && Date.now() - Date.parse(cached.updatedAt) < POINTS_MAX_AGE) return cached.points;
  try {
    return await refreshPoints();
  } catch (err) {
    if (cached) return cached.points; // CTT em baixo: usa a lista antiga
    throw err;
  }
}

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const distKm = (a, b) => {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};

/** Pesquisa por coordenadas (mais próximos) ou por código postal / localidade / nome. */
export async function searchPoints({ query, latitude, longitude, limit = 20 }) {
  const points = await allPoints();
  if (latitude != null && longitude != null) {
    const here = { lat: Number(latitude), lng: Number(longitude) };
    return points.filter((p) => p.lat && p.lng).map((p) => ({ ...p, distanceKm: distKm(here, p) }))
      .sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
  }
  const q = norm(query).trim();
  const cp = q.match(/^(\d{4})(?:\s*-?\s*(\d{3}))?$/);
  const hits = cp
    ? points.filter((p) => p.postalCode.startsWith(cp[1])).sort((a, b) => (b.postalCode === `${cp[1]}-${cp[2]}`) - (a.postalCode === `${cp[1]}-${cp[2]}`))
    : points.filter((p) => norm(p.city).includes(q) || norm(p.name).includes(q));
  return hits.slice(0, limit);
}

export async function getPoint(id) {
  return (await allPoints()).find((p) => p.id === String(id)) || null;
}

// ---------------------------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------------------------
export const trackingUrl = (objectNumber) =>
  `https://appserver.ctt.pt/CustomerArea/PublicArea_Detail?ObjectCodeInput=${encodeURIComponent(objectNumber)}&SearchInput=${encodeURIComponent(objectNumber)}`;

// Eventos (Eventosws.GetEventosObjectos_V3, autenticado com o AuthenticationID). Até 50 objetos por pedido.
// Códigos indicados pela CTT; EDF (em espera) e EMH (não entregue) trazem motivo/situação, que vai na mensagem.
const EVENT_STATUS = {
  EMO: null,                 // pré-avisado (guia criada, ainda não entregue na CTT)
  EMA: "shipped",            // aceitação (entregue no balcão)
  EMB: "in_transit", EMF: "in_transit", EMG: "in_transit", EDF: "in_transit", EMZ: "in_transit", EMH: "in_transit",
  EDH: "ready_for_pickup", EMW: "ready_for_pickup",
  EMI: "delivered",
  EMM: "returned"
};

/** Converte a data da CTT (ISO, "dd-MM-yyyy HH:mm[:ss]" ou "dd/MM/yyyy ...") para ISO; "" se não reconhecer. */
function parseCttDate(s) {
  const v = String(s || "").trim();
  const m = v.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  const d = m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || "00"}:${m[5] || "00"}:${m[6] || "00"}`) : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export async function getEvents(objectNumbers) {
  const c = config();
  if (!c) throw new CttError(NOT_CONFIGURED, 503);
  const list = [...new Set(objectNumbers.filter(Boolean))].slice(0, 50);
  if (!list.length) return {};
  const xml = await soap("Eventosws", "http://tempuri.org/IEventosWS/GetEventosObjectos_V3",
    `<tempuri:GetEventosObjectos_V3><tempuri:ID>${esc(c.authId)}</tempuri:ID><tempuri:NObjectos>` +
    list.map((o) => `<arr:string xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays">${esc(o)}</arr:string>`).join("") +
    `</tempuri:NObjectos></tempuri:GetEventosObjectos_V3>`);
  const errs = tags(tag(xml, "_erros"), "string").map(decode).filter(Boolean);
  const objects = tags(xml, "DadosObjectos_V3BE");
  if (!objects.length && errs.length) throw new CttError(`CTT: ${errs.join(" | ")}`, 502, xml);
  const out = {};
  for (const obj of objects) {
    const events = tags(obj, "DadosEventos_V3BE").map((e) => ({
      code: tag(e, "_CodigoEvento").trim(),
      description: tag(e, "_DescricaoEvento").trim(),
      reason: tag(e, "_CodigoMotivo").trim(),
      situation: tag(e, "_DescricaoSituacao").trim(),
      place: tag(e, "_DescricaoNoEvento").trim(),
      receiver: tag(e, "_NomeReceptor").trim(),
      order: Number(tag(e, "_Ordem")) || 0,
      valid: tag(e, "_Valido").trim(),
      at: parseCttDate(tag(e, "_DataEvento"))
    })).filter((e) => e.code && !/^(n|false|0)$/i.test(e.valid));
    events.sort((a, b) => a.order - b.order || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    out[tag(obj, "_NObjecto").trim()] = events;
  }
  return out;
}

/** Último evento com significado → { status, message, eventAt } para applyTrackingUpdate (null se nada a aplicar). */
export function trackingUpdateFrom(events) {
  const last = (events || []).at(-1);
  if (!last) return null;
  const status = EVENT_STATUS[last.code] ?? null;
  const detail = [last.situation, last.place].filter(Boolean).join(" · ");
  return { status, message: [`${last.description || last.code}`, detail].filter(Boolean).join(" — "), eventAt: last.at || undefined, code: last.code };
}