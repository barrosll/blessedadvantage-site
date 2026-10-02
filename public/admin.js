(function () {
  var PW_KEY = "ba-admin";
  var MAX_SIDE = 2000; // píxeis no lado maior depois de reduzir a foto
  var catalog = null;
  var editing = null; // cópia do produto aberto no editor
  var editingIndex = -1; // -1 = nova

  var $ = function (id) { return document.getElementById(id); };
  var euro = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toEuros(cents) { return (cents / 100).toFixed(2).replace(".", ","); }
  function toCents(text) {
    var n = Number(String(text).trim().replace(/\s|€/g, "").replace(",", "."));
    return isFinite(n) ? Math.round(n * 100) : NaN;
  }
  function randomId(n) { return Math.random().toString(36).slice(2, 2 + n); }
  function slug(text) {
    return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "impressao";
  }

  function getPassword() { try { return sessionStorage.getItem(PW_KEY) || ""; } catch (e) { return ""; } }
  function setPassword(pw) { try { pw ? sessionStorage.setItem(PW_KEY, pw) : sessionStorage.removeItem(PW_KEY); } catch (e) {} }

  var toastTimer;
  function toast(msg, isError) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (isError ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, isError ? 5000 : 2200);
  }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ Authorization: "Bearer " + getPassword() }, options.headers || {});
    return fetch(path, options).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { showLogin("A sessão expirou. Entre novamente."); throw new Error("Password errada"); }
        if (!r.ok) throw new Error(data.error || "Erro " + r.status);
        return data;
      });
    });
  }

  // ---------- Entrar / sair ----------
  function showLogin(message) {
    setPassword("");
    $("mainView").hidden = true;
    $("topActions").hidden = true;
    $("loginView").hidden = false;
    $("loginError").textContent = message || "";
  }
  function showMain() {
    $("loginView").hidden = true;
    $("mainView").hidden = false;
    $("topActions").hidden = false;
    api("/api/admin/catalog").then(function (data) {
      catalog = data;
      renderList();
      renderShipping();
      renderSiteImages();
    }).catch(function (err) { toast(err.message, true); });
    loadOrders();
    api("/api/admin/login", { method: "POST" }).then(function (info) {
      var n = $("sendcloudNotice");
      n.hidden = info.sendcloud && !info.sendcloudMock;
      n.textContent = info.sendcloudMock
        ? "Modo de simulação da Sendcloud (só local): envios, etiquetas e pontos de recolha são de teste."
        : "Sendcloud ainda não configurado: as encomendas ficam registadas, mas os envios e as etiquetas só são criados depois de definir SENDCLOUD_PUBLIC_KEY e SENDCLOUD_SECRET_KEY na Netlify.";
    }).catch(function () {});
  }

  // ---------- Separadores ----------
  function showTab(name) {
    [].forEach.call(document.querySelectorAll(".tab"), function (t) { t.setAttribute("aria-selected", String(t.dataset.tab === name)); });
    $("tab-orders").hidden = name !== "orders";
    $("tab-products").hidden = name !== "products";
    try { sessionStorage.setItem("ba-tab", name); } catch (e) {}
  }
  document.querySelector(".tabs").addEventListener("click", function (e) {
    var t = e.target.closest(".tab");
    if (t) showTab(t.dataset.tab);
  });
  try { if (sessionStorage.getItem("ba-tab")) showTab(sessionStorage.getItem("ba-tab")); } catch (e) {}

  // ---------- Encomendas ----------
  var orders = [];
  var selected = {}; // token -> true
  var STATUS = {
    paid: "Paga", production: "Em produção", ready_to_ship: "Preparada", shipped: "Enviada", in_transit: "Em trânsito",
    ready_for_pickup: "Disponível para recolha", delivered: "Entregue", cancelled: "Cancelada", returned: "Devolvida"
  };
  var EMAILS = { confirmation: "Confirmação", shipping: "A caminho", pickup: "Disponível p/ recolha", delivered: "Entregue", admin: "Aviso à loja" };
  var EMAIL_FIELD = { confirmation: "confirmationEmailSentAt", shipping: "shippingEmailSentAt", pickup: "pickupEmailSentAt", delivered: "deliveredEmailSentAt", admin: "adminEmailSentAt" };
  var dateFmt = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  var dayFmt = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short" });
  var OPEN = ["paid", "production", "ready_to_ship"];

  function loadOrders() {
    return api("/api/admin/orders").then(function (list) {
      orders = list;
      renderOrders();
    }).catch(function (err) { toast(err.message, true); });
  }
  function shipError(o) { return o.shippingStatus === "shipping_error"; }
  function filtered() {
    var f = $("orderFilter").value;
    return orders.filter(function (o) {
      if (f === "abertas") return OPEN.indexOf(o.status) >= 0;
      if (f === "erro") return shipError(o);
      if (f === "transito") return o.status === "shipped" || o.status === "in_transit";
      if (f === "cancelled") return o.status === "cancelled" || o.status === "returned";
      return f ? o.status === f : true;
    });
  }
  function carrierLabel(o) {
    var c = (o.shippingCarrier || "").toLowerCase();
    return c.indexOf("inpost") === 0 ? "InPost" : c.indexOf("ctt") === 0 ? "CTT" : c ? c.toUpperCase() : "—";
  }
  function renderOrders() {
    $("ordersCount").textContent = orders.filter(function (o) { return OPEN.indexOf(o.status) >= 0; }).length || "";
    var list = filtered();
    // limpa seleções de encomendas que já não estão visíveis
    Object.keys(selected).forEach(function (t) { if (!list.some(function (o) { return o.token === t; })) delete selected[t]; });
    if (!list.length) {
      $("orderList").innerHTML = '<p class="muted">' + (orders.length ? "Nenhuma encomenda neste filtro." : "Ainda não há encomendas. Quando alguém comprar, aparece aqui.") + "</p>";
      updateBulk();
      return;
    }
    $("orderList").innerHTML = list.map(orderCard).join("");
    updateBulk();
  }
  function orderCard(o) {
    var a = o.address || {};
    var sp = o.servicePoint;
    var items = o.items.map(function (it) {
      return "<li>" + (it.image ? '<img src="' + esc(it.image) + '" alt="">' : "<span></span>") +
        "<div><strong>" + it.qty + "× " + esc(it.title) + '</strong><div class="muted small">' + esc(it.details) + "</div>" +
        (it.note ? '<div class="note">Personalização: “' + esc(it.note) + "”</div>" : "") + "</div>" +
        "<span>" + euro.format(it.unitPrice * it.qty / 100) + "</span></li>";
    }).join("");
    var errors = o.emailErrors || {};
    var warns = (shipError(o)
        ? '<div class="o-warn"><span><strong>⚠ ENVIO NÃO CRIADO</strong><br>' + esc(o.shippingError || "") + '</span><button class="btn btn-sm" data-act="retry-shipment">Tentar novamente</button></div>'
        : o.shippingStatus === "not_configured" ? '<div class="o-warn" style="background:#fffbe0;color:#5c5c00">Sendcloud ainda não configurado — envio por criar.</div>' : "");
    var hasNote = o.items.some(function (it) { return it.note; });
    var emails = Object.keys(EMAILS).filter(function (k) { return k !== "pickup" || sp; }).map(function (k) {
      var at = o[EMAIL_FIELD[k]];
      return "<li><span>" + EMAILS[k] + ': <span class="muted">' + (at ? "enviado " + dateFmt.format(new Date(at)) : errors[k] ? "⚠ " + esc(errors[k]) : "—") + "</span></span>" +
        '<button class="btn btn-ghost" data-act="resend" data-type="' + k + '">' + (at ? "Reenviar" : "Enviar") + "</button></li>";
    }).join("");
    var canLabel = Boolean(o.sendcloudParcelId);
    return '<details class="order-card" data-token="' + esc(o.token) + '">' +
      '<summary><input type="checkbox" class="sel" data-sel="' + esc(o.token) + '"' + (selected[o.token] ? " checked" : "") + ' aria-label="Selecionar ' + esc(o.number) + '">' +
      '<span class="num">' + esc(o.number) + "</span>" +
      '<span class="who"><div><strong>' + esc(o.name) + "</strong>" + (hasNote ? ' <span class="badge" style="background:#fffbe0;color:#5c5c00">personalizado</span>' : "") + "</div>" +
      '<div class="muted small">' + o.items.reduce(function (n, it) { return n + it.qty; }, 0) + " peça(s) · " + euro.format(o.total / 100) + " · " +
      (o.paymentStatus === "paid" ? "Pago" : esc(o.paymentStatus || "")) + (o.eta ? " · prevista até " + dayFmt.format(new Date(o.eta[1])) : "") + "</div>" +
      (o.trackingNumber ? '<div class="trk">' + esc(o.trackingNumber) + "</div>" : "") + "</span>" +
      '<span class="carrier">' + carrierLabel(o) + (sp ? " · ponto" : "") + "</span>" +
      (shipError(o) ? '<span class="warn-ship">⚠ envio</span>' : '<span class="st st-' + esc(o.status) + '">' + (STATUS[o.status] || esc(o.status)) + "</span>") +
      '<button class="btn btn-ghost btn-sm" data-act="label"' + (canLabel ? "" : " disabled title=\"Envio ainda não criado\"") + ">Etiqueta</button></summary>" +
      '<div class="order-body"><div>' + warns +
        "<h4>Peças</h4><ul class=\"o-items\">" + items + "</ul>" +
        '<p class="small" style="margin:8px 0 0">Subtotal ' + euro.format(o.subtotal / 100) + (o.discount ? " · Desconto −" + euro.format(o.discount / 100) : "") +
        " · Portes " + euro.format(o.shipping / 100) + " · <strong>Total " + euro.format(o.total / 100) + "</strong></p>" +
        '<h4 style="margin-top:18px">Entrega</h4><p class="small" style="margin:0;line-height:1.7">' +
        "<strong>" + esc(o.shippingMethodName || "—") + "</strong>" + (o.parcelWeight ? " · " + esc(o.parcelWeight) + " kg" : "") + "<br>" +
        (sp ? "Ponto: " + esc(sp.name) + " — " + esc(sp.street) + ", " + esc(sp.postalCode) + " " + esc(sp.city) + "<br>" : "") +
        (o.sendcloudStatus ? "Sendcloud: " + esc(o.sendcloudStatus) + "<br>" : "") +
        (o.labelPrintedAt ? "Etiqueta impressa " + dateFmt.format(new Date(o.labelPrintedAt)) + "<br>" : "") + "</p>" +
        '<h4 style="margin-top:18px">Cliente</h4><p class="small" style="margin:0;line-height:1.7">' +
        esc(a.name) + "<br>" + esc(a.line1) + (a.line2 ? "<br>" + esc(a.line2) : "") + "<br>" + esc(a.postalCode) + " " + esc(a.city) + "<br>" +
        '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + "</a> · " + esc(o.phone) + (o.taxId ? "<br>NIF " + esc(o.taxId) : "") + "</p>" +
        '<h4 style="margin-top:18px">Emails</h4><ul class="emails-list">' + emails + "</ul>" +
      '</div><div class="o-actions">' +
        '<label class="field"><span>Estado</span><select class="field-select" data-f="status">' +
          Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === o.status ? " selected" : "") + ">" + STATUS[k] + "</option>"; }).join("") +
        "</select></label>" +
        '<label class="field"><span>Código de seguimento</span><input type="text" data-f="tracking" value="' + esc(o.trackingNumber || "") + '" placeholder="preenchido pela Sendcloud" autocomplete="off"></label>' +
        '<p class="hint" style="margin:0">“Enviada” / “Entregue” enviam o email correspondente ao cliente (uma só vez). “Cancelada” tenta cancelar o envio na Sendcloud — o reembolso faz-se na Stripe.</p>' +
        '<button class="btn btn-sm" data-act="save">Guardar estado</button>' +
        '<button class="btn btn-ghost btn-sm" data-act="label"' + (canLabel ? "" : " disabled") + ">Imprimir etiqueta</button>" +
        (o.trackingUrl ? '<a class="btn btn-ghost btn-sm" href="' + esc(o.trackingUrl) + '" target="_blank" rel="noopener" style="text-decoration:none">Abrir tracking ↗</a>' : "") +
        '<button class="btn btn-ghost btn-sm" data-act="refresh-tracking"' + (o.trackingNumber || o.sendcloudShipmentId ? "" : " disabled") + ">Atualizar tracking</button>" +
        '<a class="btn btn-ghost btn-sm" href="' + esc(o.trackUrl || "#") + '" target="_blank" rel="noopener" style="text-decoration:none">Ver página do cliente ↗</a>' +
      "</div></div></details>";
  }

  function replaceOrder(updated) {
    orders = orders.map(function (o) { return o.token === updated.token ? updated : o; });
    renderOrders();
    var again = document.querySelector('.order-card[data-token="' + updated.token + '"]');
    if (again) again.open = true;
  }

  // Abre um PDF numa janela nova (aberta já no clique, para o browser não a bloquear)
  function openPdf(win, blob) {
    var url = URL.createObjectURL(blob);
    if (win && !win.closed) win.location.href = url; else window.open(url, "_blank");
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  function printLabel(token, number) {
    var win = window.open("", "_blank");
    if (win) win.document.write("<p style='font-family:sans-serif'>A obter a etiqueta " + esc(number) + "…</p>");
    fetch("/api/admin/label?token=" + encodeURIComponent(token), { headers: { Authorization: "Bearer " + getPassword() } })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || "Erro " + r.status); });
        return r.blob();
      })
      .then(function (blob) { openPdf(win, blob); loadOrders(); })
      .catch(function (err) { if (win) win.close(); toast(err.message, true); });
  }

  $("orderFilter").addEventListener("change", renderOrders);
  $("refreshOrders").addEventListener("click", function () { loadOrders().then(function () { toast("Encomendas atualizadas"); }); });

  // Seleção (o checkbox está dentro do <summary>: não abrir/fechar o cartão ao clicar nele)
  $("orderList").addEventListener("click", function (e) {
    if (e.target.matches("input.sel")) { e.stopPropagation(); return; }
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    e.preventDefault();
    var card = b.closest(".order-card");
    var token = card.dataset.token;
    var order = orders.find(function (o) { return o.token === token; });
    if (b.dataset.act === "label") { printLabel(token, order.number); return; }

    var payload = { token: token };
    if (b.dataset.act === "resend") { payload.action = "resend"; payload.type = b.dataset.type; }
    else if (b.dataset.act === "retry-shipment" || b.dataset.act === "refresh-tracking") payload.action = b.dataset.act;
    else {
      payload.status = card.querySelector('[data-f="status"]').value;
      payload.trackingNumber = card.querySelector('[data-f="tracking"]').value;
      if (payload.status === "cancelled" && order.status !== "cancelled" &&
        !confirm("Cancelar a encomenda " + order.number + "?\nO envio na Sendcloud é cancelado se possível. O reembolso NÃO é automático — faz-se no painel da Stripe.")) return;
    }
    b.disabled = true;
    api("/api/admin/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (res) { replaceOrder(res.order); toast(res.message); })
      .catch(function (err) { toast(err.message, true); b.disabled = false; });
  });
  $("orderList").addEventListener("change", function (e) {
    if (!e.target.matches("input.sel")) return;
    if (e.target.checked) selected[e.target.dataset.sel] = true; else delete selected[e.target.dataset.sel];
    updateBulk();
  });
  $("selectAll").addEventListener("change", function () {
    var on = $("selectAll").checked;
    filtered().forEach(function (o) { if (on) selected[o.token] = true; else delete selected[o.token]; });
    renderOrders();
  });
  function selectedOrders() {
    return orders.filter(function (o) { return selected[o.token]; });
  }
  function updateBulk() {
    var sel = selectedOrders();
    var visible = filtered();
    $("selCount").textContent = sel.length ? sel.length + (sel.length === 1 ? " encomenda selecionada" : " encomendas selecionadas") : "";
    $("selectAll").checked = visible.length > 0 && visible.every(function (o) { return selected[o.token]; });
    $("bulkLabels").disabled = !sel.length;
    $("bulkLabels").textContent = sel.length ? "Imprimir " + sel.length + (sel.length === 1 ? " etiqueta" : " etiquetas") : "Imprimir etiquetas";
    $("bulkTracking").disabled = !sel.length;
  }

  // Junta vários PDFs num só (no browser, para não esbarrar nos limites de tamanho das funções)
  var pdfLibPromise = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!pdfLibPromise) {
      pdfLibPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
        s.onload = function () { resolve(window.PDFLib); };
        s.onerror = function () { pdfLibPromise = null; reject(new Error("Não foi possível carregar o juntador de PDFs")); };
        document.head.appendChild(s);
      });
    }
    return pdfLibPromise;
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function progress(text) {
    $("bulkProgress").hidden = !text;
    $("bulkProgress").textContent = text || "";
  }

  // Etiquetas em lote: grupos de 20 (limite da Sendcloud), um grupo de cada vez; continua mesmo com falhas
  $("bulkLabels").addEventListener("click", function () {
    var sel = selectedOrders();
    if (!sel.length) return;
    var win = window.open("", "_blank");
    if (win) win.document.write("<p style='font-family:sans-serif'>A preparar " + sel.length + " etiquetas…</p>");
    var tokens = sel.map(function (o) { return o.token; });
    var groups = [];
    for (var i = 0; i < tokens.length; i += 20) groups.push(tokens.slice(i, i + 20));
    var pdfs = [], ok = [], failed = [];
    $("bulkLabels").disabled = true;
    var chain = Promise.resolve();
    groups.forEach(function (group, gi) {
      chain = chain.then(function () {
        progress("A obter etiquetas… " + Math.min((gi + 1) * 20, tokens.length) + " / " + tokens.length);
        return api("/api/admin/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokens: group }) })
          .then(function (res) { pdfs = pdfs.concat(res.pdfs); ok = ok.concat(res.ok); failed = failed.concat(res.failed); })
          .catch(function (err) {
            group.forEach(function (t) {
              var o = orders.find(function (x) { return x.token === t; });
              failed.push({ number: o ? o.number : "?", reason: err.message });
            });
          });
      });
    });
    chain.then(function () {
      if (!pdfs.length) return null;
      progress("A juntar " + ok.length + " etiquetas num só PDF…");
      return loadPdfLib().then(function (PDFLib) {
        return PDFLib.PDFDocument.create().then(function (merged) {
          return pdfs.reduce(function (p, b64) {
            return p.then(function () {
              return PDFLib.PDFDocument.load(b64ToBytes(b64)).then(function (doc) {
                return merged.copyPages(doc, doc.getPageIndices()).then(function (pages) { pages.forEach(function (pg) { merged.addPage(pg); }); });
              });
            });
          }, Promise.resolve()).then(function () { return merged.save(); });
        });
      });
    }).then(function (bytes) {
      if (bytes) openPdf(win, new Blob([bytes], { type: "application/pdf" }));
      else if (win) win.close();
      var msg = ok.length + (ok.length === 1 ? " etiqueta pronta" : " etiquetas prontas");
      if (failed.length) msg += "\n" + failed.length + " falharam: " + failed.map(function (f) { return f.number + " (" + f.reason + ")"; }).join("; ");
      progress(msg);
      toast(failed.length ? ok.length + " prontas, " + failed.length + " falharam" : msg, Boolean(failed.length));
      loadOrders();
    }).catch(function (err) {
      if (win) win.close();
      progress("Erro: " + err.message);
      toast(err.message, true);
    }).then(function () { updateBulk(); });
  });

  $("bulkTracking").addEventListener("click", function () {
    var tokens = selectedOrders().filter(function (o) { return o.trackingNumber || o.sendcloudShipmentId; }).map(function (o) { return o.token; });
    if (!tokens.length) { toast("Nenhuma das encomendas selecionadas tem envio", true); return; }
    $("bulkTracking").disabled = true;
    progress("A consultar o tracking de " + tokens.length + " encomendas…");
    api("/api/admin/tracking-refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokens: tokens }) })
      .then(function (res) {
        progress(res.checked + " consultadas · " + res.updated + " atualizadas" + (res.failed.length ? " · " + res.failed.length + " falharam" : ""));
        return loadOrders();
      })
      .catch(function (err) { progress(""); toast(err.message, true); })
      .then(function () { updateBulk(); });
  });

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = $("password").value;
    $("loginError").textContent = "";
    fetch("/api/admin/login", { method: "POST", headers: { Authorization: "Bearer " + pw } }).then(function (r) {
      if (!r.ok) { $("loginError").textContent = "Password errada."; return; }
      setPassword(pw);
      $("password").value = "";
      showMain();
    }).catch(function () { $("loginError").textContent = "Sem ligação. Tente novamente."; });
  });
  $("logout").addEventListener("click", function () { showLogin(); });

  // ---------- Guardar ----------
  function save(next, okMessage) {
    return api("/api/admin/catalog", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next)
    }).then(function (saved) {
      catalog = saved;
      renderList();
      renderShipping();
      renderSiteImages();
      toast(okMessage || "Guardado ✓");
      return saved;
    });
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  // ---------- Lista ----------
  function priceRange(p) {
    if (!p.options.length) return "sem preço";
    var prices = p.options.map(function (o) { return o.price; });
    var min = Math.min.apply(null, prices), max = Math.max.apply(null, prices);
    return min === max ? euro.format(min / 100) : euro.format(min / 100) + " – " + euro.format(max / 100);
  }
  function catName(id) {
    var c = catalog.categories.find(function (c) { return c.id === id; });
    return c ? c.name : "";
  }
  function renderList() {
    var n = catalog.products.length;
    $("productList").innerHTML = n ? catalog.products.map(function (p, i) {
      return '<div class="item">' +
        (p.images[0] ? '<img src="' + esc(p.images[0]) + '" alt="">' : '<div class="thumb-empty"></div>') +
        '<div><div class="title">' + (p.title ? esc(p.title) : '<span class="muted">(sem nome)</span>') +
        (p.visible ? "" : '<span class="badge">escondido</span>') + '</div>' +
        '<div class="muted small">' + (catName(p.category) ? esc(catName(p.category)) + ' · ' : '') + (p.options.length ? priceRange(p) + ' · ' + p.options.length + ' variação(ões)' : 'sem preço · aparece como “Em breve”') +
        ((p.colors || []).length ? ' · ' + p.colors.length + ' cor(es)' : '') + (p.custom ? ' · personalizável' : '') +
        ' · ' + p.images.length + ' foto(s)</div></div>' +
        '<div class="actions">' +
        '<button class="icon" data-move="-1" data-i="' + i + '" aria-label="Subir"' + (i === 0 ? " disabled" : "") + '>↑</button>' +
        '<button class="icon" data-move="1" data-i="' + i + '" aria-label="Descer"' + (i === n - 1 ? " disabled" : "") + '>↓</button>' +
        '<button class="btn btn-ghost btn-sm" data-edit="' + i + '">Editar</button></div></div>';
    }).join("") : '<p class="muted">Ainda não há produtos. Clique em “+ Novo produto”.</p>';
  }
  $("productList").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.edit) openEditor(Number(b.dataset.edit));
    if (b.dataset.move) {
      var i = Number(b.dataset.i), j = i + Number(b.dataset.move);
      var next = clone(catalog);
      var tmp = next.products[i]; next.products[i] = next.products[j]; next.products[j] = tmp;
      save(next, "Ordem guardada ✓").catch(function (err) { toast(err.message, true); });
    }
  });

  // ---------- Imagens do site ----------
  function renderSiteImages() {
    var site = catalog.site || {};
    [].forEach.call(document.querySelectorAll("#siteImages .slot"), function (slot) {
      var custom = site[slot.dataset.key];
      slot.querySelector("img").src = custom || slot.dataset.default;
      slot.querySelector("[data-reset]").hidden = !custom;
    });
  }
  function saveSiteImage(key, value, message) {
    var next = clone(catalog);
    next.site = Object.assign({}, next.site);
    if (value) next.site[key] = value; else delete next.site[key];
    return save(next, message);
  }
  $("siteImages").addEventListener("change", function (e) {
    var input = e.target, slot = input.closest(".slot");
    if (!input.files || !input.files[0]) return;
    toast("A enviar imagem…");
    resizeImage(input.files[0]).then(function (blob) {
      return api("/api/admin/upload", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
    }).then(function (res) {
      return saveSiteImage(slot.dataset.key, res.url, "Imagem do site atualizada ✓");
    }).catch(function (err) { toast(err.message, true); })
      .then(function () { input.value = ""; });
  });
  $("siteImages").addEventListener("click", function (e) {
    var b = e.target.closest("[data-reset]");
    if (!b) return;
    saveSiteImage(b.closest(".slot").dataset.key, "", "Imagem original reposta")
      .catch(function (err) { toast(err.message, true); });
  });

  // ---------- Envio (métodos, produção, remetente) ----------
  var methodsDraft = [];
  function renderShipping() {
    var s = catalog.shipping || {};
    methodsDraft = clone(catalog.shippingMethods || []);
    renderMethods();
    $("prodMin").value = (s.productionDays || [3, 5])[0];
    $("prodMax").value = (s.productionDays || [3, 5])[1];
    var snd = catalog.sender || {};
    $("sndName").value = snd.name || "";
    $("sndStreet").value = snd.street || "";
    $("sndPostal").value = snd.postalCode || "";
    $("sndCity").value = snd.city || "";
    $("sndPhone").value = snd.phone || "";
    $("sndEmail").value = snd.email || "";
  }
  function renderMethods() {
    $("methodRows").innerHTML = methodsDraft.map(function (m, i) {
      var f = function (key, label, value, extra) {
        return '<label>' + label + '<input type="text" data-m="' + key + '" data-i="' + i + '" value="' + esc(value == null ? "" : value) + '"' + (extra || "") + "></label>";
      };
      return '<div class="method-row">' +
        f("name", "Nome (cliente vê)", m.name, ' maxlength="60"') +
        f("carrier", "Transportadora", m.carrier, ' placeholder="ex.: ctt" maxlength="40"') +
        f("sendcloudCode", "Código Sendcloud", m.sendcloudCode, ' placeholder="carregar da Sendcloud" maxlength="120"') +
        f("price", "Preço (€)", m.price == null ? "" : toEuros(m.price), ' inputmode="decimal" placeholder="—"') +
        f("freeFrom", "Grátis a partir (€)", m.freeFrom ? toEuros(m.freeFrom) : "", ' inputmode="decimal" placeholder="nunca"') +
        '<label>Transporte (dias)<span style="display:flex;gap:4px;align-items:center"><input type="text" data-m="d0" data-i="' + i + '" value="' + m.days[0] + '" inputmode="numeric" style="width:42px"> a <input type="text" data-m="d1" data-i="' + i + '" value="' + m.days[1] + '" inputmode="numeric" style="width:42px"></span></label>' +
        '<div class="flags"><label><input type="checkbox" data-m="enabled" data-i="' + i + '"' + (m.enabled ? " checked" : "") + "> Ativo</label>" +
        '<label><input type="checkbox" data-m="requiresServicePoint" data-i="' + i + '"' + (m.requiresServicePoint ? " checked" : "") + "> Ponto de recolha</label>" +
        '<button type="button" class="icon" data-delmethod="' + i + '" aria-label="Remover método">×</button></div>' +
        "</div>";
    }).join("");
  }
  $("methodRows").addEventListener("input", function (e) {
    var el = e.target, m = methodsDraft[Number(el.dataset.i)];
    if (!m || !el.dataset.m) return;
    var k = el.dataset.m;
    if (k === "enabled" || k === "requiresServicePoint") m[k] = el.checked;
    else if (k === "price") m.price = el.value.trim() === "" ? null : toCents(el.value);
    else if (k === "freeFrom") m.freeFrom = el.value.trim() === "" ? 0 : toCents(el.value);
    else if (k === "d0") m.days[0] = Number(el.value) || 1;
    else if (k === "d1") m.days[1] = Number(el.value) || 1;
    else m[k] = el.value;
  });
  $("methodRows").addEventListener("change", function (e) {
    var el = e.target, m = methodsDraft[Number(el.dataset.i)];
    if (m && (el.dataset.m === "enabled" || el.dataset.m === "requiresServicePoint")) m[el.dataset.m] = el.checked;
  });
  $("methodRows").addEventListener("click", function (e) {
    var b = e.target.closest("[data-delmethod]");
    if (!b) return;
    methodsDraft.splice(Number(b.dataset.delmethod), 1);
    renderMethods();
  });
  $("addMethod").addEventListener("click", function () {
    methodsDraft.push({ id: "metodo-" + randomId(4), name: "", carrier: "", sendcloudCode: "", price: null, freeFrom: 0, days: [2, 4], requiresServicePoint: false, enabled: false });
    renderMethods();
  });

  // Opções da conta Sendcloud: mostra código, transportadora e preço contratual (só referência)
  $("loadSendcloud").addEventListener("click", function () {
    var box = $("scOptions");
    box.hidden = false;
    box.innerHTML = '<span class="muted">A consultar a Sendcloud…</span>';
    api("/api/admin/sendcloud-options").then(function (res) {
      var opts = res.options || [];
      if (!opts.length) { box.innerHTML = '<span class="muted">A Sendcloud não devolveu opções para Portugal. Verifica as transportadoras ativas na tua conta.</span>'; return; }
      box.innerHTML = "<strong>Opções disponíveis na tua conta Sendcloud</strong>" + opts.map(function (o, i) {
        return '<div class="opt"><span><strong>' + esc(o.name) + '</strong><br><span class="muted small">' + esc(o.carrierName || o.carrier) + " · " +
          (o.requiresServicePoint ? "ponto de recolha" : "entrega em casa") + " · código " + esc(o.code) +
          (o.quote ? " · custo contratual " + esc(o.quote.value) + " " + esc(o.quote.currency) : "") + "</span></span>" +
          '<button type="button" class="btn btn-ghost btn-sm" data-addopt="' + i + '">Usar</button></div>';
      }).join("");
      box.onclick = function (e) {
        var b = e.target.closest("[data-addopt]");
        if (!b) return;
        var o = opts[Number(b.dataset.addopt)];
        // Preenche um método existente da mesma transportadora/tipo, ou cria um novo (inativo, sem preço: definir antes de ativar)
        var target = methodsDraft.find(function (m) { return !m.sendcloudCode && m.requiresServicePoint === o.requiresServicePoint && o.carrier.indexOf(m.carrier) === 0; });
        if (target) { target.sendcloudCode = o.code; target.carrier = o.carrier; }
        else methodsDraft.push({ id: "metodo-" + randomId(4), name: o.name, carrier: o.carrier, sendcloudCode: o.code, price: null, freeFrom: 0, days: [2, 4], requiresServicePoint: o.requiresServicePoint, enabled: false });
        renderMethods();
        toast("Código aplicado — define o preço, ativa e guarda");
      };
    }).catch(function (err) { box.innerHTML = '<span style="color:var(--error)">' + esc(err.message) + "</span>"; });
  });

  $("shippingForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var next = clone(catalog);
    if (methodsDraft.some(function (m) { return m.price != null && isNaN(m.price); })) { toast("Verifica os preços dos métodos.", true); return; }
    next.shippingMethods = methodsDraft;
    next.shipping = Object.assign({}, next.shipping, {
      productionDays: [Number($("prodMin").value) || 0, Number($("prodMax").value) || 0]
    });
    next.sender = {
      name: $("sndName").value, street: $("sndStreet").value, postalCode: $("sndPostal").value,
      city: $("sndCity").value, phone: $("sndPhone").value, email: $("sndEmail").value
    };
    save(next, "Envio guardado ✓").catch(function (err) { toast(err.message, true); });
  });

  // ---------- Editor ----------
  function openEditor(index) {
    editingIndex = index;
    editing = index >= 0 ? clone(catalog.products[index]) : {
      id: "", title: "", category: "", description: "", images: [], visible: true, options: [], colors: [], custom: false
    };

    $("editorTitle").textContent = index >= 0 ? "Editar produto" : "Novo produto";
    $("fTitle").value = editing.title;
    $("fCategory").innerHTML = '<option value="">Sem categoria</option>' + catalog.categories.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
    }).join("");
    $("fCategory").value = editing.category || "";
    $("fDesc").value = editing.description;
    $("fVisible").checked = editing.visible;
    editing.colors = editing.colors || [];
    $("fCustom").checked = Boolean(editing.custom);
    renderColors();
    $("deleteProduct").hidden = index < 0;
    $("editorError").textContent = "";
    $("photoStatus").textContent = "Pode escolher várias de uma vez. A primeira é a principal; use ★ para mudar.";
    renderPhoto();
    renderOptions();
    renderCopyFrom();
    $("editor").showModal();
  }
  function renderPhoto() {
    $("photoPreview").innerHTML = editing.images.length ? editing.images.map(function (src, i) {
      return '<figure class="ph">' + '<img src="' + esc(src) + '" alt="">' +
        (i === 0 ? '<span class="ph-main">principal</span>' : '<button type="button" class="ph-btn ph-left" data-first="' + i + '" title="Tornar principal">★</button>') +
        '<button type="button" class="ph-btn ph-del" data-delphoto="' + i + '" title="Remover foto" aria-label="Remover foto">×</button></figure>';
    }).join("") : '<p class="muted small" style="margin:0">Ainda sem fotos.</p>';
  }
  $("photoPreview").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.delphoto) editing.images.splice(Number(b.dataset.delphoto), 1);
    if (b.dataset.first) editing.images.unshift(editing.images.splice(Number(b.dataset.first), 1)[0]);
    renderPhoto();
  });
  function renderOptions() {
    document.querySelector(".options-table thead").hidden = editing.options.length === 0;
    $("optionRows").innerHTML = editing.options.map(function (o, i) {
      return '<tr>' +
        '<td><input type="text" data-f="label" data-i="' + i + '" value="' + esc(o.label) + '" placeholder="ex.: Preto · 20 cm" maxlength="80"></td>' +
        '<td><input type="text" data-f="price" data-i="' + i + '" value="' + (o.price ? toEuros(o.price) : "") + '" inputmode="decimal" placeholder="25,00"></td>' +
        '<td><input type="text" data-f="weight" data-i="' + i + '" value="' + String(o.weight).replace(".", ",") + '" inputmode="decimal"></td>' +
        '<td><button type="button" class="icon" data-remove="' + i + '" aria-label="Remover variação">×</button></td></tr>';
    }).join("");
  }
  function renderCopyFrom() {
    var others = catalog.products.map(function (p, i) { return { p: p, i: i }; })
      .filter(function (x) { return x.i !== editingIndex && x.p.options.length; });
    $("copyFrom").hidden = others.length === 0;
    $("copyFrom").innerHTML = '<option value="">Copiar variações e cores de…</option>' + others.map(function (x) {
      return '<option value="' + esc(x.p.id) + '">' + esc(x.p.title || "Produto " + (x.i + 1)) + '</option>';
    }).join("");
  }
  function addOptionRow() {
    editing.options.push({ id: randomId(6), label: "", price: 0, weight: 0.3 });
  }

  $("optionRows").addEventListener("input", function (e) {
    var el = e.target, o = editing.options[Number(el.dataset.i)];
    if (!o) return;
    if (el.dataset.f === "label") o.label = el.value;
    if (el.dataset.f === "price") o.price = toCents(el.value);
    if (el.dataset.f === "weight") o.weight = Number(el.value.replace(",", "."));
  });
  $("optionRows").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-remove]");
    if (!b) return;
    editing.options.splice(Number(b.dataset.remove), 1);
    renderOptions();
  });
  // Cores
  function renderColors() {
    $("colorRows").innerHTML = editing.colors.map(function (c, i) {
      return '<div class="color-row">' +
        '<input type="color" data-cf="hex" data-i="' + i + '" value="' + esc(c.hex || "#cccccc") + '" aria-label="Cor">' +
        '<input type="text" data-cf="name" data-i="' + i + '" value="' + esc(c.name) + '" placeholder="ex.: Preto mate" maxlength="40">' +
        '<button type="button" class="icon" data-delcolor="' + i + '" aria-label="Remover cor">×</button></div>';
    }).join("");
  }
  $("colorRows").addEventListener("input", function (e) {
    var el = e.target, c = editing.colors[Number(el.dataset.i)];
    if (c && el.dataset.cf) c[el.dataset.cf] = el.value;
  });
  $("colorRows").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-delcolor]");
    if (!b) return;
    editing.colors.splice(Number(b.dataset.delcolor), 1);
    renderColors();
  });
  $("addColor").addEventListener("click", function () {
    editing.colors.push({ name: "", hex: "#222222" });
    renderColors();
    var inputs = $("colorRows").querySelectorAll("input[type=text]");
    inputs[inputs.length - 1].focus();
  });

  $("addOption").addEventListener("click", function () { addOptionRow(); renderOptions(); });
  $("copyFrom").addEventListener("change", function () {
    var src = catalog.products.find(function (p) { return p.id === $("copyFrom").value; });
    if (src) {
      editing.options = clone(src.options);
      editing.colors = clone(src.colors || []);
      editing.custom = Boolean(src.custom);
      $("fCustom").checked = editing.custom;
      renderOptions();
      renderColors();
      toast("Variações e cores copiadas");
    }
    $("copyFrom").value = "";
  });
  $("cancelEdit").addEventListener("click", function () { $("editor").close(); });

  // Reduz a foto no browser (fica mais rápida na loja e cabe no limite de envio)
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error("Não foi possível ler a foto")); }, "image/jpeg", 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Formato de foto não suportado")); };
      img.src = url;
    });
  }
  $("photoInput").addEventListener("change", function () {
    var files = [].slice.call($("photoInput").files);
    if (!files.length) return;
    var done = 0, failed = 0;
    $("saveProduct").disabled = true;
    $("photoStatus").textContent = "A enviar " + files.length + " foto(s)…";
    // Envia uma de cada vez, pela ordem escolhida
    files.reduce(function (chain, file) {
      return chain.then(function () {
        return resizeImage(file).then(function (blob) {
          return api("/api/admin/upload", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
        }).then(function (res) {
          editing.images.push(res.url);
          done++;
          renderPhoto();
        }).catch(function () { failed++; });
      });
    }, Promise.resolve()).then(function () {
      $("photoStatus").textContent = done + " foto(s) carregada(s)" + (failed ? ", " + failed + " falharam" : "") + ". Clique em Guardar para aplicar.";
      $("saveProduct").disabled = false;
      $("photoInput").value = "";
    });
  });

  $("editorForm").addEventListener("submit", function (e) {
    e.preventDefault();
    editing.title = $("fTitle").value.trim();
    editing.category = $("fCategory").value;
    editing.description = $("fDesc").value.trim();
    editing.visible = $("fVisible").checked;
    editing.custom = $("fCustom").checked;
    for (var c = 0; c < editing.colors.length; c++) {
      if (!editing.colors[c].name.trim()) { $("editorError").textContent = "Preencha o nome de todas as cores (ou remova as vazias)."; return; }
    }
    if (!editing.id) editing.id = slug(editing.title || "produto") + "-" + randomId(4);

    for (var i = 0; i < editing.options.length; i++) {
      var o = editing.options[i];
      if (!o.label.trim()) { $("editorError").textContent = "Preencha o nome de todas as variações."; return; }
      if (!(o.price > 0)) { $("editorError").textContent = "Preço inválido em “" + o.label + "”."; return; }
      if (!(o.weight > 0)) { $("editorError").textContent = "Peso inválido em “" + o.label + "”."; return; }
    }

    var next = clone(catalog);
    if (editingIndex >= 0) next.products[editingIndex] = editing;
    else next.products.push(editing);

    $("saveProduct").disabled = true;
    save(next).then(function () {
      $("editor").close();
    }).catch(function (err) {
      $("editorError").textContent = err.message;
    }).then(function () { $("saveProduct").disabled = false; });
  });

  $("deleteProduct").addEventListener("click", function () {
    if (!confirm("Apagar este produto? Esta ação não pode ser desfeita.")) return;
    var next = clone(catalog);
    next.products.splice(editingIndex, 1);
    save(next, "Produto apagado").then(function () { $("editor").close(); })
      .catch(function (err) { $("editorError").textContent = err.message; });
  });

  $("newProduct").addEventListener("click", function () { openEditor(-1); });

  // Arranque: se já entrou nesta sessão, verifica a password guardada
  if (getPassword()) {
    fetch("/api/admin/login", { method: "POST", headers: { Authorization: "Bearer " + getPassword() } })
      .then(function (r) { r.ok ? showMain() : showLogin(); })
      .catch(function () { showLogin("Sem ligação."); });
  }
})();
