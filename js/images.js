/*
 * images.js — affichage des photos du bucket privé « wishia ».
 * Le bucket n'est pas public : chaque photo s'affiche via une adresse
 * signée temporaire (1 h), demandée par lot et gardée en mémoire.
 */

const Images = (() => {
  const BUCKET = "wishia";
  const TTL_SECONDS = 3600;
  const cache = new Map(); // chemin → { url, expires }

  function url(path) {
    const hit = path ? cache.get(path) : null;
    return hit && hit.expires > Date.now() ? hit.url : "";
  }

  // Demande les adresses manquantes. Renvoie true si de nouvelles sont arrivées.
  async function ensure(paths) {
    const missing = [...new Set(paths.filter((p) => p && !url(p)))];
    if (!missing.length) return false;
    const { data, error } = await supabaseClient.storage.from(BUCKET).createSignedUrls(missing, TTL_SECONDS);
    if (error) {
      console.error("Erreur de chargement des photos :", error.message);
      return false;
    }
    // Marge de 5 minutes : une adresse n'expire jamais pendant qu'elle est affichée.
    const expires = Date.now() + (TTL_SECONDS - 300) * 1000;
    let added = false;
    data.forEach((entry) => {
      if (entry.signedUrl && entry.path) {
        cache.set(entry.path, { url: entry.signedUrl, expires });
        added = true;
      }
    });
    return added;
  }

  function forget(path) {
    cache.delete(path);
  }

  return { BUCKET, url, ensure, forget };
})();
