/*
 * auth.js — écran de connexion et gestion de la session Supabase.
 * Tant que personne n'est connecté, seul l'écran de connexion est
 * visible ; le reste de l'app (#app-shell) reste caché.
 * Même compte que pour Coach.ia, Brain.ia et les autres apps « Divers.ia ».
 * Pas de création de compte ici : l'app est réservée à un compte existant.
 */

const authGate = document.getElementById("auth-gate");
const appShell = document.getElementById("app-shell");
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const authSubmitBtn = document.getElementById("auth-submit-btn");

let appStarted = false;

async function showApp() {
  appStarted = true;
  authGate.hidden = true;
  appShell.hidden = false;
  const ok = await Storage.refresh();
  App.start();
  if (!ok) showToast("Base introuvable : lance les scripts de supabase/migrations.");
}

function showAuthGate() {
  appStarted = false;
  authGate.hidden = false;
  appShell.hidden = true;
  authForm.reset();
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.hidden = true;
  authSubmitBtn.disabled = true;

  const { error } = await supabaseClient.auth.signInWithPassword({
    email: authEmail.value.trim(),
    password: authPassword.value,
  });
  if (error) {
    authError.textContent = "Email ou mot de passe incorrect.";
    authError.hidden = false;
  }

  authSubmitBtn.disabled = false;
});

// Le rafraîchissement automatique du jeton déclenche aussi cet événement :
// on ne relance l'app que si elle n'est pas déjà affichée.
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (session) {
    if (!appStarted) setTimeout(showApp, 0);
  } else {
    showAuthGate();
  }
});
