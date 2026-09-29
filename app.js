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
  function findSize(id) { return catalog.sizes.find(function (s) { return s.id === id; }); }

  // Galeria
  function renderGallery() {
    var from = money(Math.min.apply(null, catalog.sizes.map(function (s) { return s.price; })));
    $("galeria").innerHTML = catalog.products.map(function (p) {
      return '<button class="card" data-id="' + p.id + '">' +
        '<img src="' + p.image + '" alt="' + p.title + '" loading="lazy">' +
        '<h3>' + p.title + '</h3><p>desde ' + from + '</p></button>';
    }).join("");
  }

  // Detalhe do produto
  function openProduct(id) {
    current = findProduct(id);
    if (!current) return;
    $("dlgImage").src = current.image;
    $("dlgImage").alt = current.title;
    $("dlgTitle").textContent = current.title;
    $("dlgDesc").textContent = current.description;
    $("dlgSizes").innerHTML = "<legend>Tamanho</legend>" + catalog.sizes.map(function (s, i) {
      return '<label><span><input type="radio" name="size" value="' + s.id + '"' + (i === 0 ? " checked" : "") + ">" +
        s.label + "</span><span>" + money(s.price) + "</span></label>";
    }).join("");
    updateDialogPrice();
    $("productDialog").showModal();
  }
  function selectedSize() {
    var input = document.querySelector('#dlgSizes input:checked');
    return findSize(input ? input.value : catalog.sizes[0].id);
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
    cart = cart.filter(function (l) { return findProduct(l.id) && findSize(l.size); });
    var count = 0, subtotal = 0;
    $("cartItems").innerHTML = cart.length ? cart.map(function (l, i) {
      var p = findProduct(l.id), s = findSize(l.size);
      count += l.qty;
      subtotal += s.price * l.qty;
      return '<li><img src="' + p.image + '" alt="">' +
        '<div><div class="name">' + p.title + '</div><div class="muted small">' + s.label + '</div>' +
        '<div class="qty"><button data-i="' + i + '" data-d="-1" aria-label="Menos">−</button>' + l.qty +
        '<button data-i="' + i + '" data-d="1" aria-label="Mais">+</button></div></div>' +
        '<strong>' + money(s.price * l.qty) + '</strong></li>';
    }).join("") : '<li class="empty">O carrinho está vazio.</li>';

    $("cartCount").textContent = count;
    $("cartSubtotal").textContent = money(subtotal);
    $("checkoutBtn").disabled = cart.length === 0;

    var free = catalog.shipping.find(function (s) { return s.minSubtotal; });
    var paid = catalog.shipping.find(function (s) { return !s.minSubtotal; });
    $("shippingNote").textContent = free && subtotal >= free.minSubtotal
      ? "Envio grátis por CTT."
      : "Envio CTT: " + money(paid.price) + (free ? " · grátis acima de " + money(free.minSubtotal) : "");
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

  fetch("products.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      catalog = data;
      renderGallery();
      renderCart();
      if (location.hash === "#carrinho") openCart();
    });
})();
