/*
 * inventory.js — l'écran d'accueil : en-tête, onglets des listes,
 * recherche, tri et lignes d'objets.
 * Une seule structure HTML sert au mobile (lignes) et à l'ordinateur
 * (tableau à colonnes) : la mise en page change en CSS.
 */

const Inventory = (() => {
  const kicker = document.getElementById("inventory-kicker");
  const tabsEl = document.getElementById("list-tabs");
  const rowsEl = document.getElementById("inventory-rows");
  const emptyEl = document.getElementById("inventory-empty");
  const headEl = document.getElementById("inventory-head");
  const searchInput = document.getElementById("search-input");
  const sortSelect = document.getElementById("sort-select");

  const SORTS = {
    recent: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
    priceAsc: (a, b) => comparePrice(a, b, 1),
    priceDesc: (a, b) => comparePrice(a, b, -1),
    name: (a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name), "fr"),
  };

  let tab = "all"; // "all" ou l'id d'une liste
  let sort = "recent";
  let query = "";
  let selectedId = null;

  // Les objets sans prix vont toujours à la fin.
  function comparePrice(a, b, direction) {
    if (a.price === null && b.price === null) return 0;
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return (a.price - b.price) * direction;
  }

  // L'onglet et le tri choisis sont retenus sur cet appareil.
  function remember() {
    try {
      localStorage.setItem("wishia.view", JSON.stringify({ tab, sort }));
    } catch (e) {}
  }
  try {
    const saved = JSON.parse(localStorage.getItem("wishia.view") || "{}");
    if (saved.tab) tab = saved.tab;
    if (SORTS[saved.sort]) sort = saved.sort;
  } catch (e) {}

  function visibleItems() {
    const q = normalizeText(query.trim());
    return Storage.items()
      .filter((item) => tab === "all" || item.listId === tab)
      .filter((item) => !q || normalizeText(item.name).includes(q))
      .sort(SORTS[sort]);
  }

  function renderTabs() {
    const items = Storage.items();
    const entries = [{ id: "all", name: "Toutes", count: items.length }].concat(
      Storage.lists().map((list) => ({
        id: list.id,
        name: list.name,
        count: items.filter((item) => item.listId === list.id).length,
      }))
    );
    tabsEl.innerHTML = entries
      .map(
        (entry) => `
        <button type="button" class="tab" data-tab="${escapeHtml(entry.id)}" aria-current="${entry.id === tab}">
          ${escapeHtml(entry.name)}<span class="tab-count" aria-hidden="true">${entry.count}</span><span class="visually-hidden">, ${plural(entry.count, "objet")}</span>
        </button>`
      )
      .join("");
  }

  function rowHtml(item) {
    const list = Storage.list(item.listId);
    const listName = list ? list.name : "";
    const photo = Images.url(item.imagePath);
    const link = safeUrl(item.url);
    const date = formatDate(item.createdAt);
    return `
      <li class="row${item.id === selectedId ? " is-selected" : ""}" data-id="${escapeHtml(item.id)}">
        <div class="row-photo">${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy">` : ""}</div>
        <div class="row-main">
          <button type="button" class="row-name" data-open>${escapeHtml(item.name)}</button>
          <p class="row-meta">${escapeHtml(listName)}<span aria-hidden="true"> · </span>${escapeHtml(date)}</p>
        </div>
        <span class="row-col row-list">${escapeHtml(listName)}</span>
        <span class="row-col row-date">${escapeHtml(date)}</span>
        <div class="row-side">
          <span class="row-price">${escapeHtml(formatPrice(item.price))}</span>
          ${
            link
              ? `<a class="row-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" aria-label="Voir ${escapeHtml(item.name)} sur le site (nouvel onglet)">Voir&nbsp;↗</a>`
              : `<span class="row-link is-empty"></span>`
          }
        </div>
      </li>`;
  }

  function emptyMessage(total) {
    if (!Storage.lists().length) {
      return `<p>Commence par créer une liste : Sport, Maison, Tech, Mode…</p>
        <button type="button" class="btn btn-primary" data-manage-lists>Créer une liste</button>`;
    }
    if (!total) return `<p>Aucun objet pour l'instant. Ajoute le premier avec le bouton « + ».</p>`;
    if (query.trim()) return `<p>Aucun objet ne correspond à « ${escapeHtml(query.trim())} ».</p>`;
    return `<p>Cette liste est vide.</p>`;
  }

  function render() {
    const total = Storage.items().length;
    if (tab !== "all" && !Storage.list(tab)) tab = "all";
    if (selectedId && !Storage.item(selectedId)) selectedId = null;

    kicker.textContent = `Inventaire · ${plural(total, "objet")}`;
    sortSelect.value = sort;
    renderTabs();

    const items = visibleItems();
    rowsEl.innerHTML = items.map(rowHtml).join("");
    rowsEl.hidden = !items.length;
    headEl.classList.toggle("is-empty", !items.length);
    emptyEl.hidden = items.length > 0;
    if (!items.length) emptyEl.innerHTML = emptyMessage(total);

    // Les photos arrivent après coup : on redessine quand leurs adresses sont prêtes.
    Images.ensure(items.map((item) => item.imagePath)).then((added) => {
      if (added) render();
    });
  }

  function select(id) {
    selectedId = id;
    rowsEl.querySelectorAll(".row").forEach((row) => row.classList.toggle("is-selected", row.dataset.id === id));
  }

  tabsEl.addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) return;
    tab = button.dataset.tab;
    remember();
    render();
  });

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    render();
  });

  sortSelect.addEventListener("change", () => {
    sort = sortSelect.value;
    remember();
    render();
  });

  rowsEl.addEventListener("click", (event) => {
    const row = event.target.closest(".row");
    if (!row || !event.target.closest("[data-open]")) return;
    App.openItem(row.dataset.id);
  });

  emptyEl.addEventListener("click", (event) => {
    if (event.target.closest("[data-manage-lists]")) Lists.open();
  });

  return { render, select, currentTab: () => tab, selectedId: () => selectedId };
})();
