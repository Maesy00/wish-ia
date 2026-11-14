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

  // ---- Préparation et envoi d'une photo ----

  const MAX_WIDTH = 1200;
  const MAX_HEIGHT = 1600;
  const JPEG_QUALITY = 0.82;

  function decodeWithImg(blob) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Image illisible"));
      };
      img.src = objectUrl;
    });
  }

  // Réduit l'image (1200 px de large au plus) et la compresse en JPEG,
  // pour qu'elle reste légère. Renvoie un Blob, ou lève une erreur.
  async function resize(blob) {
    let source;
    try {
      // Respecte l'orientation des photos prises au téléphone.
      source = await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch (e) {
      source = await decodeWithImg(blob);
    }
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    if (!width || !height) throw new Error("Image vide");
    const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    // Fond blanc : une image transparente ne devient pas noire en JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (source.close) source.close();
    const result = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!result) throw new Error("Compression impossible");
    return result;
  }

  // Envoie la photo d'un objet dans le bucket. Chaque envoi a son propre nom
  // de fichier : une photo remplacée ne reste jamais affichée par un cache.
  // Renvoie le chemin enregistré, ou null en cas d'échec.
  async function upload(itemId, blob) {
    const path = `${Storage.userId()}/${itemId}-${Date.now()}.jpg`;
    const { error } = await supabaseClient.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) {
      console.error("Erreur d'envoi de la photo :", error.message);
      return null;
    }
    return path;
  }

  // Retire un fichier devenu inutile (photo remplacée ou retirée).
  async function remove(path) {
    if (!path) return;
    cache.delete(path);
    const { error } = await supabaseClient.storage.from(BUCKET).remove([path]);
    if (error) console.error("Erreur de suppression de la photo :", error.message);
  }

  return { BUCKET, url, ensure, resize, upload, remove };
})();
