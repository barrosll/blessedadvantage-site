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
    }).catch(function (err) { toast(err.message, true); });
  }

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
  function renderList() {
    var n = catalog.products.length;
    $("productList").innerHTML = n ? catalog.products.map(function (p, i) {
      return '<div class="item">' +
        (p.images[0] ? '<img src="' + esc(p.images[0]) + '" alt="">' : '<div class="thumb-empty"></div>') +
        '<div><div class="title">' + (p.title ? esc(p.title) : '<span class="muted">(sem nome)</span>') +
        (p.visible ? "" : '<span class="badge">escondido</span>') + '</div>' +
        '<div class="muted small">' + (p.options.length ? priceRange(p) + ' · ' + p.options.length + ' variação(ões)' : 'sem preço · aparece como “Em breve”') +
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

  // ---------- Portes ----------
  function renderShipping() {
    var s = catalog.shipping;
    $("shipLabel").value = s.label;
    $("shipPrice").value = toEuros(s.price);
    $("shipFree").value = s.freeFrom ? toEuros(s.freeFrom) : "";
    $("shipMin").value = s.days[0];
    $("shipMax").value = s.days[1];
  }
  $("shippingForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var next = clone(catalog);
    var price = toCents($("shipPrice").value);
    var free = $("shipFree").value.trim() ? toCents($("shipFree").value) : 0;
    if (isNaN(price) || isNaN(free)) { toast("Verifique os valores dos portes.", true); return; }
    next.shipping = {
      label: $("shipLabel").value,
      price: price,
      freeFrom: free,
      days: [Number($("shipMin").value) || 2, Number($("shipMax").value) || 4]
    };
    save(next, "Portes guardados ✓").catch(function (err) { toast(err.message, true); });
  });

  // ---------- Editor ----------
  function openEditor(index) {
    editingIndex = index;
    editing = index >= 0 ? clone(catalog.products[index]) : {
      id: "", title: "", description: "", images: [], visible: true, options: []
    };

    $("editorTitle").textContent = index >= 0 ? "Editar produto" : "Novo produto";
    $("fTitle").value = editing.title;
    $("fDesc").value = editing.description;
    $("fVisible").checked = editing.visible;
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
    $("copyFrom").innerHTML = '<option value="">Copiar variações de…</option>' + others.map(function (x) {
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
  $("addOption").addEventListener("click", function () { addOptionRow(); renderOptions(); });
  $("copyFrom").addEventListener("change", function () {
    var src = catalog.products.find(function (p) { return p.id === $("copyFrom").value; });
    if (src) { editing.options = clone(src.options); renderOptions(); toast("Variações copiadas"); }
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
    editing.description = $("fDesc").value.trim();
    editing.visible = $("fVisible").checked;
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
