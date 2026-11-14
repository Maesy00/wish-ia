/*
 * sheet.js — fenêtres de l'app, construites sur l'élément <dialog>.
 * Sur mobile la fenêtre monte du bas de l'écran, sur ordinateur elle est
 * centrée. Remplace aussi confirm(), désactivé dans les PWA iPhone.
 */

const Sheet = (() => {
  // Ouvre une fenêtre. html = contenu déjà échappé. Renvoie { el, body, close, closed }.
  // full = plein écran sur mobile (fiche, formulaire).
  // Sans titre visible, « label » nomme la fenêtre pour les lecteurs d'écran.
  function open({ title = "", label = "", html, full = false }) {
    const dialog = document.createElement("dialog");
    dialog.className = `sheet${full ? " sheet-full" : ""}`;
    if (!title && label) dialog.setAttribute("aria-label", label);
    dialog.innerHTML = `
      <div class="sheet-head">
        ${title ? `<h2 class="sheet-title">${escapeHtml(title)}</h2>` : "<span></span>"}
        <button type="button" class="link-btn" data-sheet-close>Fermer</button>
      </div>
      <div class="sheet-body">${html}</div>`;
    document.body.appendChild(dialog);

    let resolveClosed;
    const closed = new Promise((resolve) => (resolveClosed = resolve));
    const close = (value) => {
      if (dialog.open) dialog.close();
      dialog.remove();
      resolveClosed(value);
    };

    dialog.querySelector("[data-sheet-close]").addEventListener("click", () => close());
    // Échap ou clic sur le fond : on ferme.
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });

    dialog.showModal();
    return { el: dialog, body: dialog.querySelector(".sheet-body"), close, closed };
  }

  // Demande de confirmation. Renvoie true si l'utilisateur confirme.
  function confirm({ title, message, confirmLabel = "Confirmer", cancelLabel = "Annuler" }) {
    const sheet = open({
      title,
      html: `
        <p class="sheet-text">${escapeHtml(message)}</p>
        <div class="sheet-actions">
          <button type="button" class="btn" data-answer="no">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn btn-primary" data-answer="yes">${escapeHtml(confirmLabel)}</button>
        </div>`,
    });
    sheet.body.querySelector('[data-answer="no"]').addEventListener("click", () => sheet.close(false));
    sheet.body.querySelector('[data-answer="yes"]').addEventListener("click", () => sheet.close(true));
    return sheet.closed.then((value) => value === true);
  }

  return { open, confirm };
})();
