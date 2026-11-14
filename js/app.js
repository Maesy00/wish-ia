/*
 * app.js — point d'entrée de l'app une fois connecté : relie l'inventaire,
 * la gestion des listes et la fiche d'un objet.
 */

const App = (() => {
  const account = document.getElementById("account-email");
  let hiddenAt = null;

  function render() {
    Inventory.render();
    Item.render();
    account.textContent = Storage.userEmail();
  }

  function start() {
    render();
  }

  function openItem(id) {
    Item.open(id);
  }

  document.getElementById("manage-lists-btn").addEventListener("click", () => Lists.open());
  document.getElementById("sign-out-btn").addEventListener("click", () => supabaseClient.auth.signOut());
  document.getElementById("add-item-btn").addEventListener("click", () => ItemForm.open());

  // Revenir sur l'app après plus d'une minute : on recharge les données
  // (elles ont pu changer depuis un autre appareil).
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (document.getElementById("app-shell").hidden || hiddenAt === null) return;
    const away = Date.now() - hiddenAt;
    hiddenAt = null;
    if (away < 60 * 1000 || document.querySelector("dialog[open]")) return;
    await Storage.refresh();
    render();
  });

  return { start, render, openItem };
})();
