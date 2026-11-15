/*
 * export.js — bouton « Exporter mes données ».
 * Télécharge toutes les listes et tous les objets en JSON, y compris ceux
 * qui ont été supprimés (archivés). Les photos restent dans le bucket :
 * seul leur chemin (image_path) figure dans le fichier.
 */

const Exporter = (() => {
  const button = document.getElementById("export-btn");

  async function run() {
    button.disabled = true;
    const data = await Storage.exportAll();
    button.disabled = false;
    if (!data) return showToast("L'export a échoué. Vérifie ta connexion et réessaie.");

    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const content = JSON.stringify({ app: "Wish.ia", exported_at: now.toISOString(), lists: data.lists, items: data.items }, null, 2);
    const file = new File([content], `wishia-export-${day}.json`, { type: "application/json" });

    // Sur iPhone (app installée), un lien de téléchargement ne fonctionne pas
    // toujours : on passe par la feuille de partage (« Enregistrer dans Fichiers »).
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Export Wish.ia" });
        return;
      } catch (err) {
        if (err.name === "AbortError") return; // partage annulé par l'utilisateur
      }
    }

    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast(`Export téléchargé : ${plural(data.lists.length, "liste")}, ${plural(data.items.length, "objet")}.`);
  }

  button.addEventListener("click", run);

  return { run };
})();
