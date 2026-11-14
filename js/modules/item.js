/*
 * item.js — la fiche d'un objet.
 * Sur ordinateur elle s'affiche dans le panneau de droite ; sur mobile
 * elle s'ouvre en plein écran par-dessus l'inventaire.
 */

const Item = (() => {
  const aside = document.getElementById("detail");
  const desktop = window.matchMedia("(min-width: 1100px)");
  const PLACEHOLDER = `<p class="muted">Sélectionne un objet pour voir sa fiche.</p>`;

  let currentId = null;
  let sheet = null;

  function html(item) {
    const list = Storage.list(item.listId);
    const photo = Images.url(item.imagePath);
    const link = safeUrl(item.url);
    const price = formatPrice(item.price);
    return `
      <article class="fiche">
        <div class="fiche-photo${photo ? "" : " is-empty"}">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(item.name)}">` : ""}
        </div>
        <p class="kicker">${escapeHtml(list ? list.name : "")}</p>
        <h2 class="fiche-name">${escapeHtml(item.name)}</h2>
        ${price ? `<p class="fiche-price">${escapeHtml(price)}</p>` : ""}
        <dl class="fiche-facts">
          <div><dt>Ajouté le</dt><dd>${escapeHtml(formatDate(item.createdAt))}</dd></div>
          ${item.site ? `<div><dt>Site</dt><dd>${escapeHtml(item.site)}</dd></div>` : ""}
        </dl>
        ${item.note ? `<p class="fiche-note">« ${escapeHtml(item.note)} »</p>` : ""}
        ${
          link
            ? `<a class="btn btn-primary btn-block" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Voir sur le site&nbsp;↗<span class="visually-hidden"> (nouvel onglet)</span></a>`
            : ""
        }
        <div class="fiche-actions">
          <button type="button" class="link-btn" data-act="edit">Modifier</button>
          <button type="button" class="link-btn" data-act="delete">Supprimer</button>
        </div>
      </article>`;
  }

  // Redessine la fiche (appelé après chaque changement de données).
  function render() {
    const item = currentId ? Storage.item(currentId) : null;
    if (!item) {
      currentId = null;
      aside.innerHTML = PLACEHOLDER;
      if (sheet) sheet.close();
      return;
    }
    const content = html(item);
    aside.innerHTML = content;
    if (sheet) sheet.body.innerHTML = content;
    Images.ensure([item.imagePath]).then((added) => {
      if (added) render();
    });
  }

  async function remove(id) {
    const item = Storage.item(id);
    if (!item) return;
    const ok = await Sheet.confirm({
      title: "Supprimer cet objet ?",
      message: `« ${item.name} » sera retiré de ton inventaire.`,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    const archived = await Storage.archive("items", id);
    if (!archived) return showToast("L'objet n'a pas pu être supprimé.");
    showToast("Objet supprimé.");
    App.render();
  }

  function onClick(event) {
    const button = event.target.closest("[data-act]");
    if (!button || !currentId) return;
    if (button.dataset.act === "edit") ItemForm.open(currentId);
    if (button.dataset.act === "delete") remove(currentId);
  }

  function open(id) {
    currentId = id;
    Inventory.select(id);
    if (!desktop.matches && !sheet) {
      sheet = Sheet.open({ label: "Fiche de l'objet", html: "", full: true });
      sheet.body.addEventListener("click", onClick);
      sheet.closed.then(() => {
        sheet = null;
        // Sur mobile, fermer la fiche désélectionne l'objet.
        if (!desktop.matches) {
          currentId = null;
          Inventory.select(null);
          aside.innerHTML = PLACEHOLDER;
        }
      });
    }
    render();
  }

  aside.addEventListener("click", onClick);

  return { open, render, isDesktop: () => desktop.matches };
})();
