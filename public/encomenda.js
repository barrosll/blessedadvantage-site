(function () {
  var root = document.getElementById("order");
  var euro = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
  var money = function (c) { return euro.format(c / 100); };
  var day = function (d) { return new Intl.DateTimeFormat("pt-PT", { weekday: "short", day: "numeric", month: "long" }).format(new Date(d)); };
  var when = function (d) { return new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(d)); };
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Estados (inclui os nomes antigos, para encomendas anteriores)
  var LEGACY = { paga: "paid", producao: "production", enviada: "shipped", entregue: "delivered", cancelada: "cancelled" };
  var RANK = { paid: 0, production: 1, ready_to_ship: 2, shipped: 3, in_transit: 4, ready_for_pickup: 5, delivered: 6 };
  var HOME_STEPS = [["paid", "Pagamento confirmado"], ["production", "Em produção"], ["shipped", "Enviada"], ["in_transit", "Em trânsito"], ["delivered", "Entregue"]];
  var POINT_STEPS = [["paid", "Pagamento confirmado"], ["production", "Em produção"], ["ready_to_ship", "Encomenda preparada"], ["shipped", "Enviada"],
    ["in_transit", "Em trânsito"], ["ready_for_pickup", "Disponível para recolha"], ["delivered", "Entregue"]];
  var HEADLINES = {
    paid: ["Recebemos a tua encomenda", "O pagamento está confirmado e a tua peça está na fila da impressora."],
    production: ["Está a ser impressa", "A tua peça está a ganhar forma, camada a camada."],
    ready_to_ship: ["Está pronta", "A tua encomenda foi embalada e vai seguir para a transportadora."],
    shipped: ["Está a caminho", "Já entregámos a tua encomenda à transportadora."],
    in_transit: ["Está a caminho", "A tua encomenda está em trânsito."],
    ready_for_pickup: ["Já podes levantar", "A tua encomenda chegou ao ponto de recolha."],
    delivered: ["Entregue", "Esperamos que gostes da tua peça!"],
    cancelled: ["Encomenda cancelada", "Se tiveres dúvidas, responde ao email da encomenda."],
    returned: ["Encomenda devolvida", "A encomenda voltou para nós. Vamos entrar em contacto contigo."]
  };

  function render(o) {
    var status = LEGACY[o.status] || o.status;
    var sp = o.servicePoint;
    var steps = sp ? POINT_STEPS : HOME_STEPS;
    var rank = RANK[status] == null ? -1 : RANK[status];
    var current = 0;
    steps.forEach(function (s, i) { if (RANK[s[0]] <= rank) current = i; });
    var head = HEADLINES[status] || HEADLINES.paid;
    var historyAt = function (key) {
      var h = (o.history || []).filter(function (x) { return (LEGACY[x.status] || x.status) === key; }).pop();
      return h ? when(h.at) : "";
    };
    var stopped = status === "cancelled" || status === "returned";

    var track = stopped ? "" : '<ol class="track" style="grid-template-columns:repeat(' + steps.length + ',1fr)">' + steps.map(function (s, i) {
      return '<li data-n="' + (i + 1) + '" class="' + (i <= current ? "done" : "") + (i === current ? " current" : "") + '"' +
        (historyAt(s[0]) ? ' title="' + esc(historyAt(s[0])) + '"' : "") + ">" + s[1] + "</li>";
    }).join("") + "</ol>";

    var eta = "";
    if ((status === "paid" || status === "production" || status === "ready_to_ship") && o.eta) {
      eta = '<div class="eta"><strong>Entrega prevista: ' + day(o.eta[0]) + " – " + day(o.eta[1]) + '</strong><span class="muted small">Enviamos-te um email assim que a encomenda seguir para a transportadora.</span></div>';
    }
    var tracking = "";
    if (o.trackingNumber) {
      tracking = '<div class="eta"><span class="muted small">Código de seguimento</span><div class="tracking-code">' + esc(o.trackingNumber) + "</div>" +
        (o.trackingUrl ? '<p style="margin:12px 0 0"><a class="btn btn-dark" href="' + esc(o.trackingUrl) + '" target="_blank" rel="noopener">Acompanhar encomenda</a></p>' : "") + "</div>";
    }

    var items = o.items.map(function (it) {
      return "<li>" + (it.image ? '<img src="' + esc(it.image) + '" alt="">' : "<span></span>") +
        "<div><strong>" + esc(it.title) + '</strong><div class="muted small">' + esc([it.details, "Qtd. " + it.qty].filter(Boolean).join(" · ")) + "</div>" +
        (it.note ? '<div class="note">Personalização: “' + esc(it.note) + "”</div>" : "") + "</div>" +
        "<strong>" + money(it.unitPrice * it.qty) + "</strong></li>";
    }).join("");

    var a = o.address || {};
    var deliveryHtml = '<p class="label">Entrega</p><p style="margin:0 0 6px"><strong>' + esc(o.shippingMethodName || "CTT") + "</strong></p>" +
      (sp
        ? '<p style="margin:0"><span class="muted small">Ponto de recolha</span><br><strong>' + esc(sp.name) + "</strong><br>" + esc(sp.street) + "<br>" + esc(sp.postalCode) + " " + esc(sp.city) + "</p>"
        : '<p style="margin:0">' + esc(a.name) + "<br>" + esc(a.line1) + (a.line2 ? "<br>" + esc(a.line2) : "") + "<br>" + esc(a.postalCode) + " " + esc(a.city) + "</p>");

    root.innerHTML =
      '<p class="label">Encomenda #' + esc(o.number) + "</p>" +
      "<h1>" + head[0] + ", " + esc(o.firstName) + ".</h1>" +
      '<p class="lead">' + head[1] + "</p>" +
      '<section class="box' + (stopped ? " cancelled" : "") + '">' + track + eta + tracking + "</section>" +
      '<section class="box">' + deliveryHtml + "</section>" +
      '<section class="box"><p class="label">Resumo</p><ul class="items">' + items + '</ul><div class="totals">' +
        "<div><span>Subtotal</span><span>" + money(o.subtotal) + "</span></div>" +
        (o.discount ? "<div><span>Desconto</span><span>−" + money(o.discount) + "</span></div>" : "") +
        "<div><span>Portes</span><span>" + (o.shipping ? money(o.shipping) : "Grátis") + "</span></div>" +
        '<div class="grand"><span>Total pago</span><span>' + money(o.total) + "</span></div></div>" +
        '<p class="muted small" style="margin:16px 0 0">Encomenda feita a ' + when(o.createdAt) + ". Dúvidas? Responde ao email da encomenda.</p></section>";
    document.title = "Encomenda #" + o.number + " — Welabb";
  }

  var token = new URLSearchParams(location.search).get("t");
  if (!token) {
    root.innerHTML = '<h1>Encomenda não encontrada</h1><p class="lead">Abre esta página pelo link “Acompanhar encomenda” do email que te enviámos.</p><p><a class="btn btn-dark" href="/">Voltar à loja</a></p>';
    return;
  }
  fetch("/api/order?t=" + encodeURIComponent(token))
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(render)
    .catch(function () {
      root.innerHTML = '<h1>Encomenda não encontrada</h1><p class="lead">O link pode estar incompleto. Abre-o novamente a partir do email da encomenda.</p><p><a class="btn btn-dark" href="/">Voltar à loja</a></p>';
    });
})();
