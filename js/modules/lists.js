/*
 * lists.js — gestion des listes (catégories) : créer, renommer,
 * réordonner, supprimer. Tout se passe dans une fenêtre.
 * Supprimer une liste qui contient des objets propose de les déplacer.
 */

const Lists = (() => {
  let sheet = null;
  let renamingId = null;

  const countOf = (listId) => Storage.items().filter((item) => item.listId === listId).length;

  function rowHtml(list, index, total) {
    const name = escapeHtml(list.name);
    if (list.id === renamingId) {
      return `
        <li class="lm-row" data-id="${escapeHtml(list.id)}">
          <form class="lm-rename" data-rename-form>
            <label class="lm-grow">
              <span class="visually-hidden">Nouveau nom de la liste ${name}</span>
              <input class="input" name="name" value="${name}" maxlength="60" required autocomplete="off">
            </label>
            <button type="submit" class="btn btn-primary">Enregistrer</button>
            <button type="button" class="link-btn" data-act="cancel-rename">Annuler</button>
          </form>
        </li>`;
    }
    return `
      <li class="lm-row" data-id="${escapeHtml(list.id)}">
        <div class="lm-order">
          <button type="button" class="icon-btn" data-act="up" aria-label="Monter ${name}" ${index === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="icon-btn" data-act="down" aria-label="Descendre ${name}" ${index === total - 1 ? "disabled" : ""}>↓</button>
        </div>
        <div class="lm-grow">
          <span class="lm-name">${name}</span>
          <span class="lm-count">${plural(countOf(list.id), "objet")}</span>
        </div>
        <div class="lm-actions">
          <button type="button" class="link-btn" data-act="rename" aria-label="Renommer ${name}">Renommer</button>
          <button type="button" class="link-btn" data-act="delete" aria-label="Supprimer ${name}">Supprimer</button>
        </div>
      </li>`;
  }

  function render() {
    if (!sheet) return;
    const lists = Storage.lists();
    sheet.body.innerHTML = `
      ${
        lists.length
          ? `<ul class="lm-list">${lists.map((list, i) => rowHtml(list, i, lists.length)).join("")}</ul>`
          : `<p class="sheet-text">Aucune liste pour l'instant.</p>`
      }
      <form class="lm-add" data-add-form>
        <label class="lm-grow">
          <span class="field-label">Nouvelle liste</span>
          <input class="input" name="name" maxlength="60" required autocomplete="off" placeholder="Sport, Maison, Tech…">
        </label>
        <button type="submit" class="btn btn-primary">Ajouter</button>
      </form>`;
    const renameInput = sheet.body.querySelector("[data-rename-form] input");
    if (renameInput) {
      renameInput.focus();
      renameInput.select();
    }
  }

  // Après chaque changement : la fenêtre et l'inventaire derrière sont redessinés.
  function refreshAll() {
    render();
    App.render();
  }

  async function addList(form) {
    const name = form.elements.name.value.trim();
    if (!name) return;
    const positions = Storage.lists().map((list) => list.position);
    const position = positions.length ? Math.max(...positions) + 1 : 0;
    const created = await Storage.insert("lists", { name, position });
    if (!created) return showToast("La liste n'a pas pu être créée.");
    refreshAll();
    sheet.body.querySelector("[data-add-form] input").focus();
  }

  async function renameList(id, form) {
    const name = form.elements.name.value.trim();
    if (!name) return;
    const updated = await Storage.update("lists", id, { name });
    if (!updated) return showToast("La liste n'a pas pu être renommée.");
    renamingId = null;
    refreshAll();
  }

  async function moveList(id, delta) {
    const ids = Storage.lists().map((list) => list.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const ok = await Storage.reorderLists(ids);
    if (!ok) showToast("L'ordre n'a pas pu être enregistré.");
    refreshAll();
    // Le bouton utilisé a été redessiné : on lui rend le focus (clavier).
    const button = sheet.body.querySelector(`.lm-row[data-id="${CSS.escape(id)}"] [data-act="${delta < 0 ? "up" : "down"}"]`);
    if (button && !button.disabled) button.focus();
  }

  // Demande quoi faire des objets, puis archive la liste.
  async function deleteList(id) {
    const list = Storage.list(id);
    if (!list) return;
    const count = countOf(id);
    const others = Storage.lists().filter((other) => other.id !== id);
    const title = `Supprimer la liste « ${list.name} » ?`;

    let moveTo = null;
    if (!count) {
      const ok = await Sheet.confirm({ title, message: "Cette liste est vide.", confirmLabel: "Supprimer" });
      if (!ok) return;
    } else {
      const choice = await askWhatToDoWithItems(title, count, others);
      if (!choice) return;
      moveTo = choice.moveTo;
    }

    if (count) {
      const ok = moveTo ? await Storage.moveItems(id, moveTo) : await Storage.archiveItemsOfList(id);
      if (!ok) return showToast("La suppression a échoué : rien n'a été modifié.");
    }
    const archived = await Storage.archive("lists", id);
    if (!archived) showToast("La liste n'a pas pu être supprimée.");
    else showToast(moveTo ? `Liste supprimée, ${plural(count, "objet")} déplacé${count > 1 ? "s" : ""}.` : "Liste supprimée.");
    refreshAll();
  }

  // Renvoie { moveTo: id | null } ou null si l'utilisateur annule.
  function askWhatToDoWithItems(title, count, others) {
    const objects = plural(count, "objet");
    const options = others.map((other) => `<option value="${escapeHtml(other.id)}">${escapeHtml(other.name)}</option>`).join("");
    const confirmSheet = Sheet.open({
      title,
      html: `
        <form data-delete-form>
          <p class="sheet-text">Cette liste contient ${objects}.</p>
          ${
            others.length
              ? `<fieldset class="choice-group">
                  <legend class="visually-hidden">Que faire des objets ?</legend>
                  <label class="choice">
                    <input type="radio" name="mode" value="move" checked>
                    <span>Déplacer ${count > 1 ? "les objets" : "l'objet"} vers</span>
                  </label>
                  <label class="choice-select">
                    <span class="visually-hidden">Liste de destination</span>
                    <select class="input" name="target">${options}</select>
                  </label>
                  <label class="choice">
                    <input type="radio" name="mode" value="archive">
                    <span>Supprimer aussi ${count > 1 ? "les objets" : "l'objet"}</span>
                  </label>
                </fieldset>`
              : `<p class="sheet-text">Il n'y a pas d'autre liste où ${count > 1 ? "les" : "le"} déplacer : ${count > 1 ? "ils seront supprimés" : "il sera supprimé"} aussi.</p>`
          }
          <div class="sheet-actions">
            <button type="button" class="btn" data-cancel>Annuler</button>
            <button type="submit" class="btn btn-primary">Supprimer la liste</button>
          </div>
        </form>`,
    });
    const form = confirmSheet.body.querySelector("[data-delete-form]");
    form.querySelector("[data-cancel]").addEventListener("click", () => confirmSheet.close(null));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const move = others.length && form.elements.mode.value === "move";
      confirmSheet.close({ moveTo: move ? form.elements.target.value : null });
    });
    return confirmSheet.closed.then((value) => value || null);
  }

  function open() {
    renamingId = null;
    sheet = Sheet.open({ title: "Mes listes", html: "" });
    sheet.closed.then(() => (sheet = null));
    render();

    sheet.body.addEventListener("submit", (event) => {
      event.preventDefault();
      if (event.target.matches("[data-add-form]")) addList(event.target);
      if (event.target.matches("[data-rename-form]")) renameList(event.target.closest(".lm-row").dataset.id, event.target);
    });

    sheet.body.addEventListener("click", (event) => {
      const button = event.target.closest("[data-act]");
      if (!button) return;
      const id = button.closest(".lm-row").dataset.id;
      const act = button.dataset.act;
      if (act === "up") moveList(id, -1);
      if (act === "down") moveList(id, 1);
      if (act === "delete") deleteList(id);
      if (act === "rename") {
        renamingId = id;
        render();
      }
      if (act === "cancel-rename") {
        renamingId = null;
        render();
      }
    });
  }

  return { open };
})();
