/*
 * app.js — point d'entrée de l'app une fois connecté.
 * Pour l'instant : l'en-tête de l'inventaire et la déconnexion.
 * Les écrans (inventaire, fiche, formulaire) s'ajoutent aux étapes suivantes.
 */

const App = (() => {
  const kicker = document.getElementById("inventory-kicker");
  const account = document.getElementById("account-email");
  const signOutBtn = document.getElementById("sign-out-btn");

  function render() {
    const n = Storage.items().length;
    kicker.textContent = `Inventaire · ${n} objet${n > 1 ? "s" : ""}`;
    account.textContent = Storage.userEmail();
  }

  function start() {
    render();
  }

  signOutBtn.addEventListener("click", () => supabaseClient.auth.signOut());

  return { start, render };
})();
