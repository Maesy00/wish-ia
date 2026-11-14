/*
 * core.js — petits outils partagés par tous les écrans.
 */

// Tout texte saisi par l'utilisateur passe par ici avant d'être mis dans la page.
function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Message bref en bas de l'écran (remplace alert(), désactivé dans les PWA iPhone).
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("visible")));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => (toast.hidden = true), 250);
  }, 2800);
}

// Prix en euros : « 129 € » ou « 129,90 € ».
const priceRound = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const priceCents = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
function formatPrice(price) {
  if (price === null || price === undefined) return "";
  return Number.isInteger(price) ? priceRound.format(price) : priceCents.format(price);
}

// « 14 nov. 2026 »
function formatDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// Pour la recherche et le tri : sans accents ni majuscules.
function normalizeText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Seuls les liens http(s) sont cliquables (jamais javascript:, data:…).
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch (e) {
    return "";
  }
}

function plural(n, word) {
  return `${n} ${word}${n > 1 ? "s" : ""}`;
}
