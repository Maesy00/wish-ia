/*
 * wishia-fetch-product — fonction Supabase (Edge Function) de Wish.ia.
 *
 * Reçoit le lien d'un produit, télécharge la page et en extrait la photo,
 * le nom et le prix, pour pré-remplir la fiche. Deux usages :
 *   POST { "url": "https://…" }       → nom, prix et photo du produit
 *   POST { "imageUrl": "https://…" }  → la photo seule (adresse d'image collée)
 *
 * La photo est renvoyée à l'app (en base64), qui la réduit à 1200 px puis
 * l'envoie elle-même dans le bucket privé « wishia » au moment d'enregistrer.
 *
 * Sécurité :
 * - Réservée à un utilisateur connecté : le jeton reçu est vérifié auprès de
 *   Supabase Auth. Laisser « Verify JWT » ACTIVÉ dans les réglages de la fonction.
 * - Aucune clé "service_role" : la fonction n'écrit nulle part.
 * - Seules les adresses http(s) publiques sont téléchargées (pas de réseau
 *   interne), avec un délai maximum et des tailles plafonnées.
 * - Secret facultatif WISHIA_ALLOWED_USER_ID : s'il est défini, seul ce
 *   compte peut utiliser la fonction.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "https://eqydrejfdpusuvydcjdp.supabase.co";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ALLOWED_USER_ID = Deno.env.get("WISHIA_ALLOWED_USER_ID") ?? "";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 8_000_000;
const MAX_REDIRECTS = 5;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// Erreur « attendue », dont la raison est renvoyée à l'app.
class FetchProblem extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Qui appelle ?
// ---------------------------------------------------------------------------

// Renvoie l'id de l'utilisateur connecté, ou null. La clé publique "anon"
// seule ne suffit pas : il faut le jeton d'une vraie session.
async function authenticatedUserId(req: Request): Promise<string | null> {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const user = await res.json();
    return typeof user?.id === "string" ? user.id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Téléchargement prudent : adresses publiques uniquement
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // Adresse IPv4 déguisée en IPv6 (::ffff:192.168.0.1 ou ::ffff:c0a8:1).
  const mapped = lower.match(/^::ffff:(.+)$/);
  if (mapped) {
    if (mapped[1].includes(".")) return isPrivateIPv4(mapped[1]);
    const groups = mapped[1].split(":").map((g) => parseInt(g, 16));
    if (groups.length === 2 && groups.every((g) => g >= 0 && g <= 0xffff)) {
      return isPrivateIPv4(`${groups[0] >> 8}.${groups[0] & 255}.${groups[1] >> 8}.${groups[1] & 255}`);
    }
    return true;
  }
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
}

// Vérifie qu'une adresse est en http(s) et ne pointe pas vers un réseau interne.
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchProblem("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchProblem("invalid_url");
  if (url.username || url.password) throw new FetchProblem("invalid_url");

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new FetchProblem("invalid_url");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIPv4(host)) throw new FetchProblem("invalid_url");
    return url;
  }
  if (host.includes(":")) {
    if (isPrivateIPv6(host)) throw new FetchProblem("invalid_url");
    return url;
  }
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|intranet)$/.test(host) || !host.includes(".")) {
    throw new FetchProblem("invalid_url");
  }

  // Le nom peut pointer vers une adresse interne : on vérifie ce qu'il résout.
  const lookups = await Promise.allSettled([Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA")]);
  for (const lookup of lookups) {
    if (lookup.status !== "fulfilled") continue;
    for (const ip of lookup.value) {
      if (ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip)) throw new FetchProblem("invalid_url");
    }
  }
  return url;
}

// Télécharge en suivant les redirections une à une, chaque étape étant vérifiée.
async function safeFetch(rawUrl: string, headers: Record<string, string>): Promise<{ res: Response; finalUrl: URL }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    let res: Response;
    try {
      res = await fetch(url, { headers, redirect: "manual", signal });
    } catch (err) {
      const name = (err as Error)?.name;
      throw new FetchProblem(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable");
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      discard(res);
      if (!location) throw new FetchProblem("unreachable");
      current = new URL(location, url).href;
      continue;
    }
    return { res, finalUrl: url };
  }
  throw new FetchProblem("unreachable");
}

// Abandonne le corps d'une réponse dont on n'a pas besoin, sans attendre.
function discard(res: Response): void {
  res.body?.cancel().catch(() => {});
}

// Lit le corps d'une réponse sans dépasser une taille donnée.
async function readLimited(res: Response, maxBytes: number, truncate: boolean): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > maxBytes) {
        if (!truncate) throw new FetchProblem("too_large");
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } catch (err) {
    if (err instanceof FetchProblem) throw err;
    const name = (err as Error)?.name;
    throw new FetchProblem(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable");
  } finally {
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Lecture de la page
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…", euro: "€", eacute: "é", egrave: "è", ecirc: "ê",
  euml: "ë", agrave: "à", acirc: "â", ccedil: "ç", icirc: "î", iuml: "ï", ocirc: "ô", ugrave: "ù", ucirc: "û",
  Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç", oelig: "œ", OElig: "Œ", reg: "®", trade: "™", copy: "©", deg: "°",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      try {
        return point > 0 ? String.fromCodePoint(point) : match;
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 300) : null;
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  let charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
    charset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// Toutes les balises <meta> de la page : clé (property, name ou itemprop) → content.
function parseMetas(html: string): Map<string, string> {
  const metas = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    const content = (attrs.content ?? "").trim();
    if (key && content && !metas.has(key)) metas.set(key, content);
  }
  return metas;
}

type Json = Record<string, unknown>;

function isType(node: Json, wanted: string): boolean {
  const type = node["@type"];
  return Array.isArray(type) ? type.includes(wanted) : type === wanted;
}

// Cherche le premier objet schema.org « Product » dans les blocs JSON-LD.
function findProduct(node: unknown, depth = 0): Json | null {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findProduct(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Json;
  if (isType(obj, "Product")) return obj;
  if (isType(obj, "ProductGroup")) return findProduct(obj.hasVariant, depth + 1) ?? obj;
  return findProduct(obj["@graph"], depth + 1) ?? findProduct(obj.mainEntity, depth + 1);
}

function parseJsonLdProduct(html: string): Json | null {
  const blocks = html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    try {
      const product = findProduct(JSON.parse(block[1].trim()));
      if (product) return product;
    } catch {
      // Bloc JSON-LD mal formé : on passe au suivant.
    }
  }
  return null;
}

function firstImage(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstImage(entry);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Json;
    return firstImage(obj.url) ?? firstImage(obj.contentUrl);
  }
  return null;
}

function firstOffer(offers: unknown): Json | null {
  if (Array.isArray(offers)) return (offers.find((o) => o && typeof o === "object") as Json) ?? null;
  return offers && typeof offers === "object" ? (offers as Json) : null;
}

// « 1 299,00 », « 1,299.00 », « 129.9 », 129 → nombre à deux décimales, ou null.
function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  if (typeof value !== "string") return null;
  let text = value.replace(/[^\d.,]/g, "");
  if (!text) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Les deux séparateurs : le dernier est celui des décimales.
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    text = /,\d{1,2}$/.test(text) ? text.replace(",", ".") : text.replace(/,/g, "");
  } else if ((text.match(/\./g) ?? []).length > 1) {
    text = text.replace(/\./g, "");
  }
  const price = Number(text);
  return Number.isFinite(price) && price >= 0 && price < 100_000_000 ? Math.round(price * 100) / 100 : null;
}

type Extracted = { name: string | null; price: number | null; currency: string | null; imageUrl: string | null };

// Ordre de priorité demandé : Open Graph, puis JSON-LD, puis Twitter, puis <title>.
function extract(html: string, pageUrl: URL): Extracted {
  const metas = parseMetas(html);
  const product = parseJsonLdProduct(html);
  const offer = product ? firstOffer(product.offers) : null;
  const spec = offer ? firstOffer(offer.priceSpecification) : null;

  const name =
    cleanText(metas.get("og:title")) ??
    cleanText(product?.name) ??
    cleanText(metas.get("twitter:title")) ??
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);

  const price =
    parsePrice(metas.get("product:price:amount")) ??
    parsePrice(metas.get("og:price:amount")) ??
    parsePrice(offer?.price) ??
    parsePrice(offer?.lowPrice) ??
    parsePrice(spec?.price);

  const currency =
    cleanText(metas.get("product:price:currency")) ??
    cleanText(metas.get("og:price:currency")) ??
    cleanText(offer?.priceCurrency) ??
    cleanText(spec?.priceCurrency);

  const rawImage =
    metas.get("og:image") ??
    metas.get("og:image:secure_url") ??
    (product ? firstImage(product.image) : null) ??
    metas.get("twitter:image") ??
    metas.get("twitter:image:src") ??
    null;

  let imageUrl: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage), pageUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") imageUrl = resolved.href;
    } catch {
      // Adresse d'image inutilisable : la fiche sera sans photo.
    }
  }

  return { name, price, currency: price !== null && currency ? currency.toUpperCase().slice(0, 3) : null, imageUrl };
}

// ---------------------------------------------------------------------------
// Les deux opérations
// ---------------------------------------------------------------------------

type ImagePayload = { base64: string; contentType: string };

async function downloadImage(imageUrl: string, referer?: string): Promise<ImagePayload> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
  };
  if (referer) headers.Referer = referer;
  const { res } = await safeFetch(imageUrl, headers);
  if (!res.ok) {
    discard(res);
    throw new FetchProblem("image");
  }
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(contentType)) {
    discard(res);
    throw new FetchProblem("image");
  }
  const bytes = await readLimited(res, MAX_IMAGE_BYTES, false);
  if (!bytes.length) throw new FetchProblem("image");
  return { base64: toBase64(bytes), contentType };
}

async function fetchProduct(rawUrl: string) {
  const { res, finalUrl } = await safeFetch(rawUrl, {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
  });
  if (!res.ok) {
    discard(res);
    throw new FetchProblem([401, 403, 429, 503].includes(res.status) ? "blocked" : "unreachable");
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/html|xml/i.test(contentType)) {
    discard(res);
    throw new FetchProblem("not_html");
  }
  const html = decodeHtml(await readLimited(res, MAX_HTML_BYTES, true), contentType);
  const found = extract(html, finalUrl);
  if (!found.name && found.price === null && !found.imageUrl) throw new FetchProblem("empty");

  let image: ImagePayload | null = null;
  if (found.imageUrl) {
    try {
      image = await downloadImage(found.imageUrl, finalUrl.origin + "/");
    } catch {
      // La photo n'a pas pu être téléchargée : le reste de la fiche est quand même renvoyé.
    }
  }
  return { ok: true, ...found, image };
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  const userId = await authenticatedUserId(req);
  if (!userId) return json({ ok: false, reason: "unauthorized" }, 401);
  if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) return json({ ok: false, reason: "forbidden" }, 403);

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "invalid_url" }, 400);
  }

  try {
    if (typeof body.imageUrl === "string" && body.imageUrl.length <= 2048) {
      const image = await downloadImage(body.imageUrl.trim());
      return json({ ok: true, image, imageUrl: body.imageUrl.trim() });
    }
    if (typeof body.url === "string" && body.url.length <= 2048) {
      return json(await fetchProduct(body.url.trim()));
    }
    return json({ ok: false, reason: "invalid_url" }, 400);
  } catch (err) {
    // Les échecs prévus (site qui bloque, délai dépassé…) sont renvoyés en 200
    // avec leur raison : l'app affiche alors un message sobre.
    if (err instanceof FetchProblem) return json({ ok: false, reason: err.reason });
    console.error("wishia-fetch-product :", (err as Error)?.message);
    return json({ ok: false, reason: "unreachable" });
  }
}

Deno.serve(handle);
