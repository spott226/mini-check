// public/assets/app.js
(() => {
  const $ = (id) => document.getElementById(id);

  const state = { biz: null, cart: new Map() };
  // cart: key -> { productId, qty, variants }

  // =========================
  // Seguridad básica (sin backend)
  // =========================
  const COOLDOWN_SECONDS = 10;
  let cooldownTimer = null;
  let cooldownRemaining = 0;

  const sanitizeText = (value, maxLen = 120) => {
    // 1) string safe
    let s = String(value ?? "");

    // 2) remover caracteres de control (incluye \u0000-\u001F y \u007F-\u009F)
    s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

    // 3) normalizar espacios (tabs/newlines -> espacios) y colapsar múltiples
    s = s.replace(/\s+/g, " ").trim();

    // 4) recortar longitud
    if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);

    return s;
  };

  const sanitizePhone = (value, maxLen = 15) => {
    // Tel: sólo dígitos, recorta
    let s = String(value ?? "").replace(/[^\d]/g, "");
    if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  };

  const isHoneypotTripped = () => {
    // Si el honeypot existe y tiene algo, bloquear
    const hp = $("companyWebsite");
    if (!hp) return false;
    const v = sanitizeText(hp.value, 80);
    return v.length > 0;
  };

  const startCooldown = (btn) => {
    // evita stacking
    if (cooldownTimer) return;

    cooldownRemaining = COOLDOWN_SECONDS;
    btn.disabled = true;

    const tick = () => {
      if (cooldownRemaining <= 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        cooldownRemaining = 0;
        btn.disabled = false;
        btn.textContent = "Enviar pedido por WhatsApp";
        return;
      }
      btn.textContent = `Espera ${cooldownRemaining}s…`;
      cooldownRemaining -= 1;
    };

    tick();
    cooldownTimer = setInterval(tick, 1000);
  };

  const stopCooldown = (btn) => {
    if (cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
    cooldownRemaining = 0;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Enviar pedido por WhatsApp";
    }
  };

  const money = (n) =>
    Number(n || 0).toLocaleString("es-MX", {
      style: "currency",
      currency: state.biz?.currency || "MXN",
    });

  const getSlug = () => {
  const path = location.pathname.replace(/^\/+|\/+$/g, "");
  
  if (!path) return "lunaboutiqueags"; // default

  if (path === "luna") return "lunaboutiqueags";
  if (path === "f1") return "playerasf1";
  if (path === "CheliSpa") return "chelispa";

  return path;
};

  async function loadBusiness(slug) {
    const res = await fetch(`/business/${encodeURIComponent(slug)}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`No existe el negocio "${slug}".`);
    return res.json();
  }

  const norm = (s) => String(s || "").trim().toLowerCase();

  function renderTheme() {
    if (state.biz.theme?.primary) {
      document.documentElement.style.setProperty("--primary", state.biz.theme.primary);
    }
  }

  function renderLogo() {
    if (!state.biz.logo) return;
    const container = $("logoContainer");
    if (!container) return;
    container.innerHTML = "";
    const img = document.createElement("img");
    img.src = state.biz.logo;
    img.className = "logo";
    container.appendChild(img);
  }

  function getDefaultImage(p) {
    const colorVar = (p.variants || []).find((v) => norm(v.type) === "color");
    const first = colorVar?.options?.[0];
    const img = typeof first === "string" ? null : first?.image;
    return img || p.image || "";
  }

  function readSelectedVariants(selects) {
    const obj = {};
    selects.forEach((s) => {
      obj[String(s.dataset.variant || "").trim()] = s.value;
    });
    return obj;
  }

  function makeCartKey(productId, variantsObj) {
    // Ordena keys para que el key sea estable
    const keys = Object.keys(variantsObj || {}).sort();
    const sig = keys.map((k) => `${k}=${variantsObj[k]}`).join("|");
    return `${productId}__${sig}`;
  }

  function renderLineItems(container, productId) {
    // Pinta solo las líneas de ese producto
    const items = Array.from(state.cart.entries()).filter(([, v]) => v.productId === productId);

    container.innerHTML = "";

    items.forEach(([key, item]) => {
      const row = document.createElement("div");
      row.className = "line-item";

      const variantsText =
        item.variants && Object.keys(item.variants).length
          ? Object.entries(item.variants)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")
          : "Sin opciones";

      row.innerHTML = `
        <div class="line-item-left">
          <div class="line-item-variants">${variantsText}</div>
          <button class="line-remove" type="button">Quitar</button>
        </div>
        <input class="line-qty" type="number" min="1" step="1" value="${item.qty}" />
      `;

      const qtyInput = row.querySelector(".line-qty");
      const removeBtn = row.querySelector(".line-remove");

      qtyInput.addEventListener("input", () => {
        const v = Math.max(1, parseInt(qtyInput.value || "1", 10));
        const current = state.cart.get(key);
        if (!current) return;
        current.qty = v;
        state.cart.set(key, current);
        recalc(true);
      });

      removeBtn.addEventListener("click", () => {
        state.cart.delete(key);
        renderLineItems(container, productId);
        recalc(true);
      });

      container.appendChild(row);
    });
  }

  function render() {
    renderTheme();
    renderLogo();

    $("bizName").textContent = state.biz.name || "Pedido";
    $("bizNote").textContent = state.biz.note || "";

    const list = $("productList");
    list.innerHTML = "";

    state.biz.products.forEach((p) => {
      const row = document.createElement("div");
      row.className = "product";

      const currentImage = getDefaultImage(p);

      const variantsHtml = (p.variants || [])
        .map((variant) => {
          const type = variant.type || "Opción";
          const options = (variant.options || [])
            .map((o) => {
              const name = typeof o === "string" ? o : o?.name;
              return `<option value="${name}">${name}</option>`;
            })
            .join("");

          return `
            <label class="label small">${type}</label>
            <select class="variant-select" data-variant="${type}">
              ${options}
            </select>
          `;
        })
        .join("");

      row.innerHTML = `
        <div class="product-left">
          ${currentImage ? `<img src="${currentImage}" class="product-img" alt="${p.name}">` : ""}
          <div class="product-info">
            <div class="product-name">${p.name}</div>
            <div class="price">${money(p.price)}</div>
            ${variantsHtml}
            <button class="add-variant btn-mini" type="button">Agregar esta combinación</button>
            <div class="line-items"></div>
          </div>
        </div>
      `;

      const img = row.querySelector(".product-img");
      const selects = Array.from(row.querySelectorAll(".variant-select"));
      const addBtn = row.querySelector(".add-variant");
      const lineItemsBox = row.querySelector(".line-items");

      // Cambio de imagen cuando cambia Color (si hay image)
      const colorVar = (p.variants || []).find((v) => norm(v.type) === "color");
      const colorSelect = selects.find((s) => norm(s.dataset.variant) === "color");

      if (colorVar && colorSelect && img) {
        colorSelect.addEventListener("change", () => {
          const selectedName = colorSelect.value;
          const selectedOpt = (colorVar.options || []).find((o) => {
            const name = typeof o === "string" ? o : o?.name;
            return name === selectedName;
          });
          const newImg = typeof selectedOpt === "string" ? null : selectedOpt?.image;
          if (newImg) img.src = newImg;
        });
      }

      // Agregar combinación al carrito como línea independiente
      addBtn.addEventListener("click", () => {
        const variants = readSelectedVariants(selects);
        const key = makeCartKey(p.id, variants);

        const existing = state.cart.get(key);
        if (existing) {
          existing.qty += 1;
          state.cart.set(key, existing);
        } else {
          state.cart.set(key, { productId: p.id, qty: 1, variants });
        }

        row.classList.add("active");
        renderLineItems(lineItemsBox, p.id);
        recalc(true);
      });

      // Render inicial de líneas por si ya existían
      renderLineItems(lineItemsBox, p.id);

      list.appendChild(row);
    });

    renderShippingOptions();
    recalc();
  }

  function renderShippingOptions() {
    const shippingSelect = $("shippingType");
    if (!shippingSelect) return;

    shippingSelect.innerHTML = "";

    if (state.biz.shipping?.enabled && state.biz.shipping.options) {
      state.biz.shipping.options.forEach((opt) => {
        const option = document.createElement("option");
        option.value = opt.id;
        option.textContent = `${opt.label} (${money(opt.cost)})`;
        shippingSelect.appendChild(option);
      });

      shippingSelect.addEventListener("change", () => recalc(true));
    }
  }

  function recalc(animate = false) {
    const byId = new Map(state.biz.products.map((p) => [p.id, p]));
    let subtotal = 0;

    for (const [, item] of state.cart.entries()) {
      const p = byId.get(item.productId);
      if (!p) continue;
      subtotal += Number(p.price) * Number(item.qty);
    }

    let shipping = 0;
    if (state.biz.shipping?.enabled && state.biz.shipping.options) {
      const selected = $("shippingType")?.value;
      const option = state.biz.shipping.options.find((o) => o.id === selected);
      shipping = option ? Number(option.cost) : 0;
    }

    const total = subtotal + shipping;

    $("subtotal").textContent = money(subtotal);
    $("shipping").textContent = money(shipping);
    $("total").textContent = money(total);

    if (animate) {
      const totalEl = $("total");
      totalEl.classList.add("pulse");
      setTimeout(() => totalEl.classList.remove("pulse"), 300);
    }

    return { subtotal, shipping, total };
  }

  function validate() {
    $("error").textContent = "";

    if (state.cart.size === 0) return "Agrega al menos 1 combinación (talla/color)";

    const name = $("customerName")?.value.trim();
    const phone = $("customerPhone")?.value.trim();
    const street = $("street")?.value.trim();
    const neighborhood = $("neighborhood")?.value.trim();
    const zip = $("zip")?.value.trim();
    const city = $("city")?.value.trim();
    const stateField = $("state")?.value.trim();

    const onlyLetters = /^[a-zA-ZÁÉÍÓÚáéíóúñÑ\s]+$/;
    const onlyNumbers = /^[0-9]+$/;

    if (!name || !onlyLetters.test(name)) return "Nombre inválido.";
    if (!phone || !onlyNumbers.test(phone) || phone.length !== 10) return "Teléfono inválido (10 dígitos).";
    if (!street) return "Ingresa calle y número.";
    if (!neighborhood) return "Ingresa colonia.";
    if (!zip || !onlyNumbers.test(zip) || zip.length !== 5) return "Código postal inválido (5 dígitos).";
    if (!city) return "Ingresa ciudad.";
    if (!stateField) return "Ingresa estado.";

    return null;
  }

  function buildMessage({ subtotal, shipping, total }) {
    const byId = new Map(state.biz.products.map((p) => [p.id, p]));
    const items = [];

    for (const [, item] of state.cart.entries()) {
      const p = byId.get(item.productId);
      if (!p) continue;

      const lineTotal = Number(p.price) * Number(item.qty);

      const variantsText =
        item.variants && Object.keys(item.variants).length
          ? Object.entries(item.variants)
              .map(([k, v]) => `${sanitizeText(k, 30)}: ${sanitizeText(v, 40)}`)
              .join(", ")
          : "";

      // Sanitiza nombre del producto por si el JSON trae algo raro (extra seguro)
      const safeProductName = sanitizeText(p.name, 80);

      items.push(`- ${safeProductName}${variantsText ? ` (${variantsText})` : ""} x${item.qty} = ${money(lineTotal)}`);
    }

    // Sanitizar inputs antes de armar WhatsApp ✅
    const name = sanitizeText($("customerName").value, 60);
    const phone = sanitizePhone($("customerPhone").value, 15);

    const street = sanitizeText($("street").value, 80);
    const neighborhood = sanitizeText($("neighborhood").value, 60);
    const zip = sanitizePhone($("zip").value, 10);
    const city = sanitizeText($("city").value, 50);
    const stateField = sanitizeText($("state").value, 50);

    const address = [
      street,
      `Col. ${neighborhood}`,
      `CP ${zip}`,
      `${city}, ${stateField}`,
    ]
      .map((x) => sanitizeText(x, 120))
      .join(", ");

    const shippingSelectedRaw = $("shippingType")?.selectedOptions?.[0]?.textContent || "";
    const shippingSelected = sanitizeText(shippingSelectedRaw, 80);

    const bizNameSafe = sanitizeText(state.biz.name, 80);

    return [
      `🧾 *Pedido para ${bizNameSafe}*`,
      "",
      `👤 *Cliente:* ${name}`,
      `📱 *Teléfono:* ${phone}`,
      `📍 *Dirección:* ${address}`,
      `🚚 *Envío:* ${shippingSelected}`,
      "",
      "🛒 *Productos:*",
      items.join("\n"),
      "",
      `Subtotal: ${money(subtotal)}`,
      `Envío: ${money(shipping)}`,
      `*Total: ${money(total)}*`,
    ].join("\n");
  }

  function openWhatsapp(message) {
    const phone = String(state.biz.whatsappPhone || "").replace(/[^\d]/g, "");
    if (!phone) throw new Error("Falta whatsappPhone en el JSON.");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    location.href = url;
  }

  async function init() {
    try {
      const slug = getSlug();
      state.biz = await loadBusiness(slug);
      document.title = state.biz.name || "Mercadia";

      $("sendBtn").addEventListener("click", () => {
        const btn = $("sendBtn");

        // Si está en cooldown, ignorar (anti doble click/spam) ⏳
        if (cooldownTimer) return;

        // Honeypot: si se llenó, bloquear silencioso 🚫🪤
        if (isHoneypotTripped()) {
          $("error").textContent = "No se pudo enviar el pedido.";
          startCooldown(btn); // castiga bots (evita reintentos rápidos)
          return;
        }

        btn.textContent = "Enviando...";
        btn.disabled = true;

        const err = validate();
        if (err) {
          btn.textContent = "Enviar pedido por WhatsApp";
          btn.disabled = false;
          $("error").textContent = err;
          return;
        }

        const totals = recalc();
        const msg = buildMessage(totals);

        // Cooldown 10s ✅ (aquí ya pasó validación y honeypot)
        startCooldown(btn);

        setTimeout(() => {
          try {
            openWhatsapp(msg);
          } catch (e) {
            // Si falla, liberamos el botón (porque no navegó)
            stopCooldown(btn);
            $("error").textContent = e.message || "Error al abrir WhatsApp.";
          }
        }, 600);
      });

      render();
    } catch (e) {
      $("bizName").textContent = "Error";
      $("bizNote").textContent = e.message;
    }
  }

  init();
})();