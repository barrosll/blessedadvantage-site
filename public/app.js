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
    $("productDialog").showModal();
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
    var line = cart.find(function (l) { return l.id === current.id && l.size === size.id; });
    if (line) line.qty += 1; else cart.push({ id: current.id, size: size.id, qty: 1 });
    saveCart();
    renderCart();
    $("productDialog").close();
    openCart();
  }

  // Carrinho
  function renderCart() {
    // Remove linhas de produtos que já não existem no catálogo
    cart = cart.filter(function (l) { return findOption(findProduct(l.id), l.size); });
    var count = 0, subtotal = 0;
    $("cartItems").innerHTML = cart.length ? cart.map(function (l, i) {
      var p = findProduct(l.id), s = findOption(p, l.size);
      count += l.qty;
      subtotal += s.price * l.qty;
      return '<li><img src="' + esc(p.images[0] || "") + '" alt="">' +
        '<div><div class="name">' + esc(p.title || "Produto") + '</div><div class="muted small">' + esc(s.label) + '</div>' +
        '<div class="qty"><button data-i="' + i + '" data-d="-1" aria-label="Menos">−</button>' + l.qty +
        '<button data-i="' + i + '" data-d="1" aria-label="Mais">+</button></div></div>' +
        '<strong>' + money(s.price * l.qty) + '</strong></li>';
    }).join("") : '<li class="empty">O carrinho está vazio.</li>';

    $("cartCount").textContent = count;
    $("cartSubtotal").textContent = money(subtotal);
    $("checkoutBtn").disabled = cart.length === 0;

    var ship = catalog.shipping;
    $("shippingNote").textContent = ship.freeFrom && subtotal >= ship.freeFrom
      ? "Envio grátis por CTT."
      : "Envio CTT: " + money(ship.price) + (ship.freeFrom ? " · grátis acima de " + money(ship.freeFrom) : "");
  }

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
    btn.disabled = true;
    btn.textContent = "A abrir pagamento…";
    $("checkoutError").textContent = "";
    fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cart })
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
        btn.disabled = false;
        btn.textContent = "Finalizar compra";
      });
  }

  // Eventos
  $("galeria").addEventListener("click", function (e) {
    var card = e.target.closest(".card");
    if (card) openProduct(card.dataset.id);
  });
  $("dlgSizes").addEventListener("change", updateDialogPrice);
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
      renderCategories();
      renderFilters();
      renderGallery();
      renderCart();
      if (location.hash === "#carrinho") openCart();
    });
})();
