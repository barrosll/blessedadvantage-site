(function () {
  var CART_KEY = "welabb-cart";
  var catalog = null;
  var cart = loadCart();
  var current = null; // produto aberto no detalhe

  var $ = function (id) { return document.getElementById(id); };
  var euro = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
  var money = function (cents) { return euro.format(cents / 100); };

  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch (e) { return []; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
  }
  function findProduct(id) { return catalog.products.find(function (p) { return p.id === id; }); }
  function findOption(product, id) { return product && product.options.find(function (o) { return o.id === id; }); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function categoryName(id) {
    var c = catalog.categories.find(function (c) { return c.id === id; });
    return c ? c.name : "";
  }
  function inCategory(id) {
    return catalog.products.filter(function (p) { return p.category === id; });
  }

  // Cartões de categoria (só as que têm produtos)
  function renderCategories() {
    var used = catalog.categories.filter(function (c) { return inCategory(c.id).length; });
    $("categorias").hidden = used.length === 0;
    $("categoryCards").innerHTML = used.map(function (c, i) {
      var items = inCategory(c.id);
      var cover = items.find(function (p) { return p.images[0]; });
      return '<button class="category" data-filter="' + esc(c.id) + '">' +
        (cover ? '<img src="' + esc(cover.images[0]) + '" alt="" loading="lazy">' : "") +
        '<span class="tag">Cat_' + String(i + 1).padStart(2, "0") + '</span>' +
        '<span class="cat-info"><h3>' + esc(c.name) + '</h3><span class="count">' + items.length + (items.length === 1 ? " peça" : " peças") + '</span></span></button>';
    }).join("");
  }

  // Filtros e galeria
  var activeFilter = "";
  function renderFilters() {
    var used = catalog.categories.filter(function (c) { return inCategory(c.id).length; });
    $("filters").hidden = used.length < 2;
    $("filters").innerHTML = [{ id: "", name: "Tudo" }].concat(used).map(function (c) {
      return '<button class="chip" data-filter="' + esc(c.id) + '" aria-pressed="' + (c.id === activeFilter) + '">' + esc(c.name) + '</button>';
    }).join("");
  }
  function setFilter(id) {
    activeFilter = id || "";
    renderFilters();
    renderGallery();
  }
  function renderGallery() {
    var list = activeFilter ? inCategory(activeFilter) : catalog.products;
    if (!list.length) {
      $("galeria").innerHTML = '<p class="empty-state">Novas peças em breve.</p>';
      return;
    }
    $("galeria").innerHTML = list.map(function (p) {
      var price = p.options.length
        ? '<p class="price-line">' + (p.options.length > 1 ? "desde " : "") + money(Math.min.apply(null, p.options.map(function (o) { return o.price; }))) + '</p>'
        : '<p class="price-line soon-line">Em breve</p>';
      return '<button class="card" data-id="' + esc(p.id) + '"><span class="card-img">' +
        (p.images[0] ? '<img src="' + esc(p.images[0]) + '" alt="' + esc(p.title) + '" loading="lazy">' : "") +
        (p.category ? '<span class="tag">' + esc(categoryName(p.category)) + '</span>' : "") + '</span>' +
        (p.title ? '<h3>' + esc(p.title) + '</h3>' : "") + price + '</button>';
    }).join("");
  }

  // Detalhe do produto
  function openProduct(id) {
    current = findProduct(id);
    if (!current) return;
    $("dlgThumbs").hidden = current.images.length < 2;
    $("dlgThumbs").innerHTML = current.images.map(function (src, i) {
      return '<button type="button" data-photo="' + i + '" aria-label="Foto ' + (i + 1) + '"><img src="' + esc(src) + '" alt=""></button>';
    }).join("");
    showPhoto(0);
    $("dlgCategory").textContent = categoryName(current.category);
    $("dlgCategory").hidden = !current.category;
    $("dlgTitle").textContent = current.title;
    $("dlgTitle").hidden = !current.title;
    $("dlgDesc").textContent = current.description;

    // Sem variações = ainda sem preço: mostra "Em breve" em vez do botão de compra
    var buyable = current.options.length > 0;
    $("dlgSizes").hidden = current.options.length < 2;
    $("dlgAdd").hidden = !buyable;
    $("dlgSoon").hidden = buyable;
    $("dlgSizes").innerHTML = "<legend>Opção</legend>" + current.options.map(function (o, i) {
      return '<label><span><input type="radio" name="size" value="' + esc(o.id) + '"' + (i === 0 ? " checked" : "") + ">" +
        esc(o.label) + "</span><span>" + money(o.price) + "</span></label>";
    }).join("");
    $("dlgPrice").textContent = "";
    if (buyable) updateDialogPrice();

    // Cores (+ "Personalizado" se o produto aceitar). Sem cores mas com personalizado: caixa "Quero personalizar"
    var colors = current.colors.slice();
    var withCustomRadio = current.custom && colors.length > 0;
    $("dlgColors").hidden = !buyable || colors.length === 0;
    $("dlgColors").innerHTML = "<legend>Cor</legend>" + colors.map(function (c, i) {
      return '<label><input type="radio" name="color" value="' + esc(c.name) + '"' + (i === 0 ? " checked" : "") + ">" +
        '<span class="swatch" style="background:' + esc(c.hex || "#ccc") + '"></span>' + esc(c.name) + "</label>";
    }).join("") + (withCustomRadio
      ? '<label><input type="radio" name="color" value="' + CUSTOM + '"><span class="swatch custom"></span>Personalizado</label>'
      : "");
    $("dlgCustomToggle").hidden = !buyable || !current.custom || colors.length > 0;
    $("dlgCustomCheck").checked = false;
    $("dlgNote").value = "";
    $("dlgError").textContent = "";
    updateNote();
    $("productDialog").showModal();
  }

  var CUSTOM = "personalizado";
  function selectedColor() {
    if (current.colors.length) {
      var input = document.querySelector('#dlgColors input:checked');
      return input ? input.value : "";
    }
    return current.custom && $("dlgCustomCheck").checked ? CUSTOM : "";
  }
  // Mostra o campo de nota só quando escolhe "Personalizado"
  function updateNote() {
    var show = selectedColor() === CUSTOM;
    $("dlgNoteWrap").hidden = !show;
    $("dlgNoteCount").textContent = $("dlgNote").value.length + "/300";
    if (show) $("dlgNote").focus();
  }
  function showPhoto(i) {
    $("dlgImage").src = current.images[i] || "";
    $("dlgImage").alt = current.title;
    $("dlgImage").hidden = !current.images[i];
    [].forEach.call($("dlgThumbs").children, function (b, j) { b.classList.toggle("active", i === j); });
  }
  function selectedSize() {
    var input = document.querySelector('#dlgSizes input:checked');
    return findOption(current, input ? input.value : current.options[0].id);
  }
  function updateDialogPrice() { $("dlgPrice").textContent = money(selectedSize().price); }

  function addToCart() {
    var size = selectedSize();
    var color = selectedColor();
    var note = color === CUSTOM ? $("dlgNote").value.trim() : "";
    if (color === CUSTOM && !note) {
      $("dlgError").textContent = "Escreve na nota como queres a peça personalizada.";
      $("dlgNote").focus();
      return;
    }
    // Linhas iguais (mesma opção, cor e nota) somam a quantidade
    var line = cart.find(function (l) {
      return l.id === current.id && l.size === size.id && (l.color || "") === color && (l.note || "") === note;
    });
    if (line) line.qty += 1; else cart.push({ id: current.id, size: size.id, color: color, note: note, qty: 1 });
    saveCart();
    renderCart();
    $("productDialog").close();
    openCart();
  }

  // Carrinho
  function renderCart() {
    // Remove linhas de produtos, opções ou cores que já não existem no catálogo
    cart = cart.filter(function (l) {
      var p = findProduct(l.id);
      if (!findOption(p, l.size)) return false;
      var color = l.color || "";
      if (color === CUSTOM) return p.custom && l.note;
      return p.colors.length ? p.colors.some(function (c) { return c.name === color; }) : color === "";
    });
    var count = 0, subtotal = 0;
    $("cartItems").innerHTML = cart.length ? cart.map(function (l, i) {
      var p = findProduct(l.id), s = findOption(p, l.size);
      count += l.qty;
      subtotal += s.price * l.qty;
      return '<li><img src="' + esc(p.images[0] || "") + '" alt="">' +
        '<div><div class="name">' + esc(p.title || "Produto") + '</div><div class="muted small">' +
        esc([s.label, l.color === CUSTOM ? "Personalizado" : l.color].filter(Boolean).join(" · ")) + '</div>' +
        (l.note ? '<div class="note-line">“' + esc(l.note) + '”</div>' : "") +
        '<div class="qty"><button data-i="' + i + '" data-d="-1" aria-label="Menos">−</button>' + l.qty +
        '<button data-i="' + i + '" data-d="1" aria-label="Mais">+</button></div></div>' +
        '<strong>' + money(s.price * l.qty) + '</strong></li>';
    }).join("") : '<li class="empty">O carrinho está vazio.</li>';

    $("cartCount").textContent = count;
    cartSubtotal = subtotal;
    renderDelivery();
  }

  // ---------- Entrega (método + ponto de recolha) ----------
  // Só para mostrar: o preço final dos portes é sempre recalculado no servidor.
  var DELIVERY_KEY = "welabb-delivery";
  var cartSubtotal = 0;
  var delivery = loadDelivery();
  function loadDelivery() {
    try { return JSON.parse(localStorage.getItem(DELIVERY_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveDelivery() {
    try { localStorage.setItem(DELIVERY_KEY, JSON.stringify(delivery)); } catch (e) {}
  }
  function methods() { return catalog.shippingMethods || []; }
  function currentMethod() {
    return methods().find(function (m) { return m.id === delivery.methodId; }) || null;
  }
  function shipCost(m) { return m.freeFrom && cartSubtotal >= m.freeFrom ? 0 : m.price; }
  function selectedPoint(m) {
    return m && m.requiresServicePoint && delivery.point && delivery.point.methodId === m.id ? delivery.point : null;
  }

  function renderDelivery() {
    var list = methods();
    if (!currentMethod() && list[0]) { delivery = { methodId: list[0].id }; saveDelivery(); }
    var m = currentMethod();
    $("deliveryMethods").innerHTML = list.map(function (x) {
      var cost = shipCost(x);
      return '<label class="method"><input type="radio" name="delivery" value="' + esc(x.id) + '"' + (m && x.id === m.id ? " checked" : "") + ">" +
        '<span class="m-name">' + esc(x.name) + '<span class="muted small">' + x.days[0] + "–" + x.days[1] + " dias úteis após envio</span></span>" +
        '<span class="m-price">' + (cost === 0 ? "Grátis" : money(cost)) + "</span></label>";
    }).join("");

    var needsPoint = Boolean(m && m.requiresServicePoint);
    var p = selectedPoint(m);
    $("pointBox").hidden = !needsPoint;
    $("pointSelected").hidden = !p;
    $("pointSelected").innerHTML = p
      ? '<span class="ok">✓ Ponto selecionado</span><strong>' + esc(p.name) + "</strong><span>" + esc(p.street) + "</span><span>" + esc(p.postalCode + " " + p.city) + "</span>"
      : "";
    $("pointBtn").textContent = p ? "Alterar" : "Escolher ponto de recolha";

    var cost = m ? shipCost(m) : 0;
    $("cartSubtotal").textContent = money(cartSubtotal);
    $("cartShipping").textContent = m ? (cost === 0 ? "Grátis" : money(cost)) : "—";
    $("cartTotal").textContent = money(cartSubtotal + cost);
    $("shippingNote").textContent = m && m.freeFrom && cost > 0 ? "Portes grátis a partir de " + money(m.freeFrom) + "." : "";

    var problem = !cart.length ? "" : !m ? "Escolhe um método de entrega." : needsPoint && !p ? "Escolhe primeiro um ponto de recolha." : "";
    $("checkoutBtn").disabled = !cart.length || Boolean(problem);
    if (!$("checkoutBtn").dataset.busy) $("checkoutError").textContent = problem;
  }

  $("deliveryMethods").addEventListener("change", function (e) {
    if (e.target.name !== "delivery") return;
    delivery = { methodId: e.target.value, point: delivery.point };
    saveDelivery();
    renderDelivery();
  });

  // Pesquisa de pontos de recolha (com espera enquanto escreve; nunca carrega todos os pontos)
  var searchTimer = null;
  var searchSeq = 0;
  var lastPoints = [];
  function openPointPicker() {
    var m = currentMethod();
    if (!m) return;
    $("pointCarrier").textContent = m.name;
    $("pointList").innerHTML = "";
    $("pointStatus").textContent = "Escreve o código postal ou a localidade.";
    $("pointDialog").showModal();
    $("pointQuery").focus();
    if ($("pointQuery").value.trim().length >= 3) searchPoints({ q: $("pointQuery").value.trim() });
  }
  function searchPoints(params) {
    var m = currentMethod();
    var seq = ++searchSeq;
    var qs = new URLSearchParams(Object.assign({ method: m.id }, params));
    $("pointStatus").textContent = "A procurar…";
    fetch("/api/service-points?" + qs.toString())
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (seq !== searchSeq) return; // resposta de uma pesquisa antiga
        if (!res.ok) throw new Error(res.data.error || "Erro");
        renderPoints(res.data.points || []);
      })
      .catch(function (err) {
        if (seq !== searchSeq) return;
        $("pointList").innerHTML = "";
        $("pointStatus").textContent = err.message === "Erro" || err.message === "Failed to fetch" ? "Não foi possível procurar agora. Tenta novamente." : err.message;
      });
  }
  function todayHours(times) {
    if (!times) return "";
    var idx = (new Date().getDay() + 6) % 7; // 0 = segunda-feira
    var slots = times[idx] || times[String(idx)];
    if (!Array.isArray(slots) || !slots.length) return "";
    return "Hoje: " + slots.map(function (s) { return (s.start_time || "") + "–" + (s.end_time || ""); }).join(", ");
  }
  function renderPoints(points) {
    lastPoints = points;
    $("pointStatus").textContent = points.length ? points.length + " pontos encontrados" : "Nenhum ponto encontrado. Experimenta outro código postal ou localidade.";
    $("pointList").innerHTML = points.map(function (p, i) {
      var extra = [
        p.distance != null ? (p.distance / 1000).toFixed(1).replace(".", ",") + " km" : "",
        p.type === "locker" ? "Cacifo 24h" : "",
        todayHours(p.openingTimes)
      ].filter(Boolean).map(esc).join(" · ");
      return '<li><button type="button" class="point-item" data-pi="' + i + '">' +
        "<strong>" + esc(p.name) + "</strong><span>" + esc(p.street) + "</span><span>" + esc(p.postalCode + " " + p.city) + "</span>" +
        (extra ? '<span class="muted small">' + extra + "</span>" : "") + "</button></li>";
    }).join("");
  }
  $("pointList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-pi]");
    if (!b) return;
    var p = lastPoints[Number(b.dataset.pi)];
    delivery.point = { methodId: delivery.methodId, id: p.id, name: p.name, street: p.street, postalCode: p.postalCode, city: p.city };
    saveDelivery();
    $("pointDialog").close();
    renderDelivery();
  });
  $("pointQuery").addEventListener("input", function () {
    clearTimeout(searchTimer);
    var q = $("pointQuery").value.trim();
    if (q.length < 3) { $("pointStatus").textContent = "Escreve pelo menos 3 caracteres."; return; }
    searchTimer = setTimeout(function () { searchPoints({ q: q }); }, 400);
  });
  $("pointGeo").addEventListener("click", function () {
    if (!navigator.geolocation) { $("pointStatus").textContent = "O teu browser não permite usar a localização."; return; }
    $("pointStatus").textContent = "A obter a tua localização…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      searchPoints({ lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5) });
    }, function () { $("pointStatus").textContent = "Não foi possível obter a localização. Escreve o código postal."; }, { timeout: 10000 });
  });
  $("pointBtn").addEventListener("click", openPointPicker);

  function changeQty(i, delta) {
    cart[i].qty += delta;
    if (cart[i].qty <= 0) cart.splice(i, 1);
    saveCart();
    renderCart();
  }

  function openCart() {
    $("cart").classList.add("open");
    $("cart").setAttribute("aria-hidden", "false");
    $("backdrop").classList.add("show");
  }
  function closeCart() {
    $("cart").classList.remove("open");
    $("cart").setAttribute("aria-hidden", "true");
    $("backdrop").classList.remove("show");
  }

  function checkout() {
    var btn = $("checkoutBtn");
    var m = currentMethod();
    var point = selectedPoint(m);
    if (!m) { $("checkoutError").textContent = "Escolhe um método de entrega."; return; }
    if (m.requiresServicePoint && !point) { $("checkoutError").textContent = "Escolhe primeiro um ponto de recolha."; return; }
    btn.disabled = true;
    btn.dataset.busy = "1";
    btn.textContent = "A abrir pagamento…";
    $("checkoutError").textContent = "";
    fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Só identificadores: preços, portes e peso são calculados no servidor
      body: JSON.stringify({ items: cart, delivery: { methodId: m.id, servicePointId: point ? point.id : "" } })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.data.url) throw new Error(res.data.error || "Erro");
        window.location.href = res.data.url;
      })
      .catch(function (err) {
        $("checkoutError").textContent = err.message === "Erro" || err.message === "Failed to fetch"
          ? "Não foi possível iniciar o pagamento. Tenta novamente."
          : err.message;
        delete btn.dataset.busy;
        btn.disabled = false;
        btn.textContent = "Pagar";
      });
  }

  // Eventos
  $("galeria").addEventListener("click", function (e) {
    var card = e.target.closest(".card");
    if (card) openProduct(card.dataset.id);
  });
  $("dlgSizes").addEventListener("change", updateDialogPrice);
  $("dlgColors").addEventListener("change", updateNote);
  $("dlgCustomCheck").addEventListener("change", updateNote);
  $("dlgNote").addEventListener("input", function () {
    $("dlgNoteCount").textContent = $("dlgNote").value.length + "/300";
    $("dlgError").textContent = "";
  });
  $("dlgThumbs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-photo]");
    if (b) showPhoto(Number(b.dataset.photo));
  });
  $("dlgAdd").addEventListener("click", addToCart);
  $("cartItems").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-i]");
    if (b) changeQty(Number(b.dataset.i), Number(b.dataset.d));
  });
  $("cartButton").addEventListener("click", openCart);
  $("cartClose").addEventListener("click", closeCart);
  $("backdrop").addEventListener("click", closeCart);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCart(); });
  $("checkoutBtn").addEventListener("click", checkout);
  $("year").textContent = new Date().getFullYear();

  // Cartões de categoria, "Ver tudo" e filtros
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-filter]");
    if (!el || !catalog) return;
    e.preventDefault();
    setFilter(el.dataset.filter);
    if (!el.classList.contains("chip")) $("loja").scrollIntoView();
  });

  // Formulários (Netlify Forms): envio sem sair da página
  function wireForm(id, okMessage) {
    var form = $(id);
    var status = form.querySelector(".form-status");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector("button");
      var data = new FormData(form);
      var hasFile = form.enctype === "multipart/form-data";
      btn.disabled = true;
      status.className = "form-status";
      status.textContent = "A enviar…";
      fetch("/", {
        method: "POST",
        headers: hasFile ? {} : { "Content-Type": "application/x-www-form-urlencoded" },
        body: hasFile ? data : new URLSearchParams(data).toString()
      }).then(function (r) {
        if (!r.ok) throw new Error();
        form.reset();
        status.className = "form-status ok";
        status.textContent = okMessage;
      }).catch(function () {
        status.className = "form-status err";
        status.textContent = "Não foi possível enviar. Tenta novamente ou escreve para ola@welabb.pt.";
      }).then(function () { btn.disabled = false; });
    });
  }
  wireForm("customForm", "Pedido recebido! Respondemos com um orçamento em breve.");
  wireForm("newsletterForm", "Subscrição feita! Vais receber o teu código de 10% por email.");

  fetch("/api/catalog")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      catalog = data;
      // Imagens do site escolhidas na gestão
      if (data.site && data.site.heroImage) $("heroImg").src = data.site.heroImage;
      if (data.site && data.site.processImage) $("processImg").src = data.site.processImage;
      renderCategories();
      renderFilters();
      renderGallery();
      renderCart();
      if (location.hash === "#carrinho") openCart();
    });
})();
