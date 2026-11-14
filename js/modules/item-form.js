/*
 * item-form.js — formulaire d'ajout et de modification d'un objet.
 * Le lien du produit vient en premier : dès qu'il est collé, la fonction
 * Supabase « wishia-fetch-product » va chercher la photo, le nom et le prix,
 * et le formulaire se pré-remplit. Tout reste modifiable avant d'enregistrer.
 * Le nom de domaine est extrait du lien ; la photo est réduite avant l'envoi.
 */

const ItemForm = (() => {
  let sheet = null;
  let form = null;
  let editing = null; // l'objet modifié, ou null pour un ajout
  let photoBlob = null; // nouvelle photo, déjà réduite
  let photoRemoved = false;
  let previewUrl = "";
  let photoSourceUrl = null;

  // Pré-remplissage par lien : ce qui a été rempli automatiquement peut être
  // remplacé par une nouvelle récupération ; ce que l'utilisateur a saisi, jamais.
  const FETCH_FUNCTION = "wishia-fetch-product";
  let lastFetchedUrl = "";
  let fetchToken = 0;
  let auto = { name: null, price: null, photo: false };

  const FETCH_MESSAGES = {
    blocked: "Ce site ne laisse pas lire ses pages.",
    timeout: "Le site met trop de temps à répondre.",
    empty: "Aucune information trouvée sur cette page.",
    not_html: "Ce lien ne mène pas à une page produit.",
    invalid_url: "Ce lien n'est pas utilisable.",
    unavailable: "La récupération automatique est indisponible pour le moment.",
  };
  const FETCH_FALLBACK = " Remplis la fiche à la main : tu peux ajouter une photo depuis ton téléphone ou coller l'adresse d'une image.";

  // « www.exemple.fr » → « exemple.fr »
  function siteOf(url) {
    const safe = safeUrl(url);
    return safe ? new URL(safe).hostname.replace(/^www\./, "") : "";
  }

  // Accepte « 129 », « 129,90 », « 1 299,00 € ». Renvoie un nombre, null (vide) ou NaN (invalide).
  function parsePrice(text) {
    const cleaned = String(text)
      .replace(/[\s\u00a0\u202f€]/g, "")
      .replace(",", ".");
    if (!cleaned) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
    return Number(cleaned);
  }

  // 129 → « 129 », 129.9 → « 129,90 »
  function priceToInput(price) {
    if (price === null || price === undefined) return "";
    return Number.isInteger(price) ? String(price) : price.toFixed(2).replace(".", ",");
  }

  function formHtml(item, lists, listId) {
    const options = lists
      .map((list) => `<option value="${escapeHtml(list.id)}"${list.id === listId ? " selected" : ""}>${escapeHtml(list.name)}</option>`)
      .join("");
    return `
      <form class="item-form" novalidate>
        <label class="field">
          <span class="field-label">Lien du produit</span>
          <input class="input" name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="https://…" value="${escapeHtml(item ? item.url || "" : "")}">
          <span class="field-hint" data-site></span>
        </label>
        <p class="fetch-status" data-fetch-status role="status" hidden></p>

        <label class="field">
          <span class="field-label">Nom</span>
          <input class="input" name="name" required maxlength="300" autocomplete="off" value="${escapeHtml(item ? item.name : "")}">
        </label>

        <div class="field-row">
          <label class="field">
            <span class="field-label">Prix (€)</span>
            <input class="input" name="price" inputmode="decimal" autocomplete="off" placeholder="Facultatif"
              value="${item ? escapeHtml(priceToInput(item.price)) : ""}">
          </label>
          <label class="field">
            <span class="field-label">Liste</span>
            <select class="input" name="listId" required>${options}</select>
          </label>
        </div>

        <div class="field">
          <span class="field-label" id="photo-label">Photo</span>
          <div class="photo-field">
            <div class="photo-preview" data-photo-preview></div>
            <div class="photo-buttons">
              <label class="link-btn photo-pick">
                <span data-photo-pick-label>Choisir une photo</span>
                <input type="file" name="photo" accept="image/*" class="visually-hidden" aria-labelledby="photo-label">
              </label>
              <button type="button" class="link-btn" data-photo-remove hidden>Retirer la photo</button>
            </div>
          </div>
          <div class="photo-url">
            <label class="photo-url-input">
              <span class="visually-hidden">Adresse d'une image</span>
              <input class="input" name="imageUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
                placeholder="ou colle l'adresse d'une image">
            </label>
            <button type="button" class="link-btn" data-photo-url-btn>Utiliser</button>
          </div>
          <p class="fetch-status" data-photo-status role="status" hidden></p>
        </div>

        <label class="field">
          <span class="field-label">Note</span>
          <textarea class="input" name="note" rows="3" maxlength="2000" placeholder="Facultative">${escapeHtml(item ? item.note || "" : "")}</textarea>
        </label>

        <p class="form-error" data-form-error role="alert" hidden></p>
        <div class="sheet-actions">
          <button type="button" class="btn" data-cancel>Annuler</button>
          <button type="submit" class="btn btn-primary" data-submit>Enregistrer</button>
        </div>
      </form>`;
  }

  function renderSite() {
    const site = siteOf(form.elements.url.value.trim());
    form.querySelector("[data-site]").textContent = site ? `Site : ${site}` : "";
  }

  function renderPhoto() {
    const existing = editing && !photoRemoved ? Images.url(editing.imagePath) : "";
    const src = previewUrl || existing;
    form.querySelector("[data-photo-preview]").innerHTML = src ? `<img src="${escapeHtml(src)}" alt="Aperçu de la photo">` : "";
    form.querySelector("[data-photo-remove]").hidden = !src;
    form.querySelector("[data-photo-pick-label]").textContent = src ? "Changer la photo" : "Choisir une photo";
  }

  // Prend une image (fichier choisi ou image récupérée), la réduit et l'affiche.
  async function setPhoto(blob, sourceUrl = null) {
    try {
      const resized = await Images.resize(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      photoBlob = resized;
      photoRemoved = false;
      photoSourceUrl = sourceUrl;
      previewUrl = URL.createObjectURL(resized);
      renderPhoto();
      return true;
    } catch (err) {
      console.error("Photo illisible :", err.message);
      return false;
    }
  }

  // ---- Récupération automatique ----

  function setStatus(selector, message, loading = false) {
    const el = form.querySelector(selector);
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle("is-loading", loading);
  }

  async function callFetchFunction(body) {
    try {
      const { data, error } = await supabaseClient.functions.invoke(FETCH_FUNCTION, { body });
      if (error || !data) return { ok: false, reason: "unavailable" };
      return data;
    } catch (e) {
      return { ok: false, reason: "unavailable" };
    }
  }

  async function imageToBlob(image) {
    const res = await fetch(`data:${image.contentType};base64,${image.base64}`);
    return res.blob();
  }

  // Une photo récupérée ne remplace pas une photo choisie par l'utilisateur.
  function hasPhoto() {
    return Boolean(photoBlob) || Boolean(editing && editing.imagePath && !photoRemoved);
  }

  function canAutoFillPhoto() {
    return auto.photo || !hasPhoto();
  }

  async function fetchFromLink() {
    const url = safeUrl(form.elements.url.value.trim());
    if (!url || url === lastFetchedUrl) return;
    lastFetchedUrl = url;
    const token = ++fetchToken;
    const forForm = form;
    setStatus("[data-fetch-status]", "Récupération des informations", true);

    const data = await callFetchFunction({ url });
    // Le formulaire a été fermé ou un autre lien a été collé entre-temps.
    if (form !== forForm || token !== fetchToken) return;
    if (!data.ok) {
      setStatus("[data-fetch-status]", (FETCH_MESSAGES[data.reason] || "Cette page n'a pas pu être lue.") + FETCH_FALLBACK);
      return;
    }

    const nameInput = form.elements.name;
    const priceInput = form.elements.price;
    let gotName = false;
    let gotPrice = false;
    let gotPhoto = false;

    if (data.name && (!nameInput.value.trim() || nameInput.value === auto.name)) {
      nameInput.value = data.name;
      auto.name = data.name;
      gotName = true;
    }
    if (typeof data.price === "number" && (!priceInput.value.trim() || priceInput.value === auto.price)) {
      priceInput.value = priceToInput(data.price);
      auto.price = priceInput.value;
      gotPrice = true;
    }
    if (data.image && canAutoFillPhoto()) {
      gotPhoto = await setPhoto(await imageToBlob(data.image), data.imageUrl || null);
      if (form !== forForm) return;
      auto.photo = gotPhoto;
    }

    const missing = [];
    if (!gotName && !nameInput.value.trim()) missing.push("le nom");
    if (!gotPrice && !priceInput.value.trim()) missing.push("le prix");
    if (!gotPhoto && !hasPhoto()) missing.push("la photo");
    let message = missing.length
      ? `Fiche pré-remplie en partie : ${missing.join(", ")} ${missing.length > 1 ? "restent" : "reste"} à compléter.`
      : "Fiche pré-remplie : vérifie les informations avant d'enregistrer.";
    if (gotPrice && data.currency && data.currency !== "EUR") message += ` Le prix trouvé est en ${data.currency} : corrige-le en euros.`;
    setStatus("[data-fetch-status]", message);
  }

  // Photo à partir d'une adresse d'image collée.
  async function usePhotoUrl() {
    const input = form.elements.imageUrl;
    const imageUrl = safeUrl(input.value.trim());
    if (!imageUrl) {
      setStatus("[data-photo-status]", "Colle une adresse commençant par http:// ou https://.");
      return;
    }
    const forForm = form;
    setStatus("[data-photo-status]", "Récupération de l'image", true);
    const data = await callFetchFunction({ imageUrl });
    if (form !== forForm) return;
    const ok = data.ok && data.image ? await setPhoto(await imageToBlob(data.image), imageUrl) : false;
    if (form !== forForm) return;
    if (ok) {
      auto.photo = false;
      input.value = "";
      setStatus("[data-photo-status]", "");
    } else {
      const reason = data.reason === "unavailable" ? FETCH_MESSAGES.unavailable : "Cette image n'a pas pu être récupérée.";
      setStatus("[data-photo-status]", `${reason} Tu peux choisir une photo depuis ton appareil.`);
    }
  }

  function clearPhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    photoBlob = null;
    photoSourceUrl = null;
    photoRemoved = true;
    auto.photo = false;
    form.elements.photo.value = "";
    renderPhoto();
  }

  function showError(message) {
    const el = form.querySelector("[data-form-error]");
    el.textContent = message;
    el.hidden = !message;
  }

  async function save() {
    const name = form.elements.name.value.trim();
    const url = form.elements.url.value.trim();
    const price = parsePrice(form.elements.price.value);
    const note = form.elements.note.value.trim();
    const listId = form.elements.listId.value;

    if (!name) {
      showError("Donne un nom à l'objet.");
      form.elements.name.focus();
      return;
    }
    if (url && !safeUrl(url)) {
      showError("Le lien doit commencer par http:// ou https://.");
      form.elements.url.focus();
      return;
    }
    if (Number.isNaN(price) || (price !== null && price > 99999999.99)) {
      showError("Le prix doit être un nombre, par exemple 129 ou 129,90.");
      form.elements.price.focus();
      return;
    }
    showError("");

    const submit = form.querySelector("[data-submit]");
    submit.disabled = true;
    submit.textContent = "Enregistrement…";
    const fail = (message) => {
      submit.disabled = false;
      submit.textContent = "Enregistrer";
      showError(message);
    };

    const id = editing ? editing.id : crypto.randomUUID();
    const oldPath = editing ? editing.imagePath : null;
    const fields = { name, url: safeUrl(url) || null, site: siteOf(url) || null, price, note: note || null, listId };

    // La photo est envoyée d'abord : la fiche n'est jamais enregistrée sans elle.
    let newPath = null;
    if (photoBlob) {
      newPath = await Images.upload(id, photoBlob);
      if (!newPath) return fail("La photo n'a pas pu être envoyée. Réessaie, ou enregistre sans photo.");
      fields.imagePath = newPath;
      fields.imageSourceUrl = photoSourceUrl;
    } else if (photoRemoved) {
      fields.imagePath = null;
      fields.imageSourceUrl = null;
    }

    const saved = editing ? await Storage.update("items", id, fields) : await Storage.insert("items", fields, id);
    if (!saved) {
      if (newPath) await Images.remove(newPath);
      return fail("L'objet n'a pas pu être enregistré. Vérifie ta connexion et réessaie.");
    }
    // L'ancienne photo ne sert plus : on libère la place.
    if (oldPath && oldPath !== saved.imagePath) Images.remove(oldPath);

    const wasEditing = Boolean(editing);
    sheet.close();
    showToast(wasEditing ? "Objet modifié." : "Objet ajouté.");
    App.render();
    if (!wasEditing && Item.isDesktop()) Item.open(saved.id);
  }

  function open(itemId) {
    const lists = Storage.lists();
    if (!lists.length) {
      showToast("Crée d'abord une liste.");
      Lists.open();
      return;
    }
    editing = itemId ? Storage.item(itemId) : null;
    photoBlob = null;
    photoRemoved = false;
    previewUrl = "";
    photoSourceUrl = null;
    // En modification, le lien déjà enregistré n'est pas récupéré de nouveau.
    lastFetchedUrl = editing ? safeUrl(editing.url || "") : "";
    fetchToken += 1;
    auto = { name: null, price: null, photo: false };

    const tab = Inventory.currentTab();
    const listId = editing ? editing.listId : tab !== "all" ? tab : lists[0].id;
    sheet = Sheet.open({ title: editing ? "Modifier l'objet" : "Nouvel objet", html: formHtml(editing, lists, listId), full: true });
    form = sheet.body.querySelector("form");
    const opened = sheet;
    sheet.closed.then(() => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (sheet === opened) {
        sheet = null;
        form = null;
      }
    });

    renderSite();
    renderPhoto();
    if (editing && editing.imagePath) Images.ensure([editing.imagePath]).then(() => form && renderPhoto());

    form.elements.url.addEventListener("input", renderSite);
    // Dès qu'un lien est collé (ou saisi puis validé), la fiche se pré-remplit.
    form.elements.url.addEventListener("paste", () => setTimeout(() => form && fetchFromLink(), 0));
    form.elements.url.addEventListener("change", fetchFromLink);
    form.querySelector("[data-photo-url-btn]").addEventListener("click", usePhotoUrl);
    form.elements.imageUrl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      usePhotoUrl();
    });
    form.elements.photo.addEventListener("change", async () => {
      const file = form.elements.photo.files[0];
      if (!file) return;
      const ok = await setPhoto(file);
      if (ok) auto.photo = false;
      else showToast("Cette image n'a pas pu être lue.");
    });
    form.querySelector("[data-photo-remove]").addEventListener("click", clearPhoto);
    form.querySelector("[data-cancel]").addEventListener("click", () => sheet.close());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save();
    });

    if (!editing) form.elements.url.focus();
  }

  return { open, setPhoto, siteOf, parsePrice, form: () => form };
})();
