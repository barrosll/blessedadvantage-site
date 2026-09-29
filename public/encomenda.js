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

  var STEPS = [["paga", "Paga"], ["producao", "Em produção"], ["enviada", "Enviada"], ["entregue", "Entregue"]];
  var HEADLINES = {
    paga: ["Recebemos a tua encomenda", "O pagamento está confirmado e a tua peça está na fila da impressora."],
    producao: ["Está a ser impressa", "A tua peça está a ganhar forma, camada a camada."],
    enviada: ["Está a caminho", "Já entregámos a tua encomenda aos CTT."],
    entregue: ["Entregue", "Esperamos que gostes da tua peça!"],
    cancelada: ["Encomenda cancelada", "Se tiveres dúvidas, responde ao email da encomenda."]
  };

  function render(o) {
    var current = STEPS.findIndex(function (s) { return s[0] === o.status; });
    var head = HEADLINES[o.status] || HEADLINES.paga;
    var historyAt = function (status) {
      var h = (o.history || []).filter(function (x) { return x.status === status; }).pop();
      return h ? when(h.at) : "";
    };

    var track = o.status === "cancelada" ? "" : '<ol class="track">' + STEPS.map(function (s, i) {
      return '<li data-n="' + (i + 1) + '" class="' + (i <= current ? "done" : "") + (i === current ? " current" : "") + '"' +
        (historyAt(s[0]) ? ' title="' + esc(historyAt(s[0])) + '"' : "") + '>' + s[1] + '</li>';
    }).join("") + "</ol>";

    var eta = "";
    if (o.status === "paga" || o.status === "producao") {
      eta = '<div class="eta"><strong>Entrega prevista: ' + day(o.eta[0]) + " – " + day(o.eta[1]) + '</strong><span class="muted small">Enviamos-te um email assim que a encomenda sair para os CTT.</span></div>';
    }
    var tracking = "";
    if (o.tracking && o.tracking.number) {
      tracking = '<div class="eta"><span class="muted small">Código de seguimento CTT</span><div class="tracking-code">' + esc(o.tracking.number) + "</div>" +
        (o.tracking.url ? '<p style="margin:12px 0 0"><a class="btn btn-dark" href="' + esc(o.tracking.url) + '" target="_blank" rel="noopener">Seguir nos CTT</a></p>' : "") + "</div>";
    }

    var items = o.items.map(function (it) {
      return "<li>" + (it.image ? '<img src="' + esc(it.image) + '" alt="">' : "<span></span>") +
        "<div><strong>" + esc(it.title) + '</strong><div class="muted small">' + esc([it.details, "Qtd. " + it.qty].filter(Boolean).join(" · ")) + "</div>" +
        (it.note ? '<div class="note">Nota: “' + esc(it.note) + "”</div>" : "") + "</div>" +
        "<strong>" + money(it.unitPrice * it.qty) + "</strong></li>";
    }).join("");

    var a = o.address;
    root.innerHTML =
      '<p class="label">Encomenda #' + esc(o.number) + "</p>" +
      "<h1>" + head[0] + ", " + esc(o.firstName) + ".</h1>" +
      '<p class="lead">' + head[1] + "</p>" +
      '<section class="box' + (o.status === "cancelada" ? " cancelled" : "") + '">' + track + eta + tracking + "</section>" +
      '<section class="box"><p class="label">Resumo</p><ul class="items">' + items + '</ul><div class="totals">' +
        "<div><span>Subtotal</span><span>" + money(o.subtotal) + "</span></div>" +
        (o.discount ? "<div><span>Desconto</span><span>−" + money(o.discount) + "</span></div>" : "") +
        "<div><span>Envio CTT</span><span>" + (o.shipping ? money(o.shipping) : "Grátis") + "</span></div>" +
        '<div class="grand"><span>Total pago</span><span>' + money(o.total) + "</span></div></div></section>" +
      '<section class="box"><p class="label">Enviamos para</p><p style="margin:0">' + esc(a.name) + "<br>" + esc(a.line1) +
        (a.line2 ? "<br>" + esc(a.line2) : "") + "<br>" + esc(a.postalCode) + " " + esc(a.city) + "</p>" +
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
