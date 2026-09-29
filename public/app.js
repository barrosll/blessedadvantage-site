(function () {
  var CART_KEY = "ba-cart";
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

  // Galeria
  function renderGallery() {
    if (!catalog.products.length) {
      $("galeria").innerHTML = '<p class="muted">Novos produtos em breve.</p>';
      return;
    }
    $("galeria").innerHTML = catalog.products.map(function (p) {
      var price = p.options.length
        ? (p.options.length > 1 ? "desde " : "") + money(Math.min.apply(null, p.options.map(function (o) { return o.price; })))
        : "Em breve";
      return '<button class="card" data-id="' + esc(p.id) + '">' +
        (p.images[0] ? '<img src="' + esc(p.images[0]) + '" alt="' + esc(p.title) + '" loading="lazy">' : '<div class="img-empty"></div>') +
        (p.title ? '<h3>' + esc(p.title) + '</h3>' : "") + '<p>' + price + '</p></button>';
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
          ? "Não foi possível iniciar o pagamento. Tente novamente."
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

  fetch("/api/catalog")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      catalog = data;
      renderGallery();
      renderCart();
      if (location.hash === "#carrinho") openCart();
    });
})();
