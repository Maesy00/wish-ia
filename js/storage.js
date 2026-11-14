/*
 * storage.js — seul endroit qui lit/écrit les données de Wish.ia.
 * Parle à la base Supabase en ligne (tables wishia_*). Comme dans Coach.ia
 * et Brain.ia, les getters restent synchrones : ils lisent un cache local
 * mis à jour après chaque appel réseau.
 *
 * Archivage : rien n'est effacé. « Supprimer » renseigne archived_at,
 * et les éléments archivés ne sont plus chargés.
 */

const Storage = (() => {
  // Correspondance champ JS → colonne Supabase, par type de donnée.
  const KINDS = {
    lists: {
      table: "wishia_lists",
      fields: { name: "name", position: "position" },
      order: [["position", true], ["created_at", true]],
    },
    items: {
      table: "wishia_items",
      fields: {
        listId: "list_id",
        name: "name",
        price: "price",
        url: "url",
        site: "site",
        imagePath: "image_path",
        imageSourceUrl: "image_source_url",
        note: "note",
      },
      order: [["created_at", false]],
    },
  };

  const cache = { lists: [], items: [] };
  let userId = null;
  let userEmail = "";

  function fromRow(kind, row) {
    const obj = { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at || null };
    for (const [key, col] of Object.entries(KINDS[kind].fields)) obj[key] = row[col] ?? null;
    // Supabase renvoie les nombres décimaux sous forme de texte.
    if (kind === "items" && obj.price !== null) obj.price = Number(obj.price);
    return obj;
  }

  // Ne convertit que les champs présents : sert aussi aux mises à jour partielles.
  function toRow(kind, obj) {
    const row = {};
    for (const [key, col] of Object.entries(KINDS[kind].fields)) {
      if (obj[key] !== undefined) row[col] = obj[key] === "" ? null : obj[key];
    }
    return row;
  }

  function sortCache(kind) {
    if (kind === "lists") {
      cache.lists.sort((a, b) => a.position - b.position || (a.createdAt < b.createdAt ? -1 : 1));
    } else {
      cache.items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }
  }

  // Supabase renvoie 1000 lignes au plus par requête : on pagine.
  async function fetchAll(kind) {
    const { table, order } = KINDS[kind];
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let query = supabaseClient.from(table).select("*").is("archived_at", null);
      order.forEach(([col, asc]) => (query = query.order(col, { ascending: asc })));
      // id départage les égalités : la pagination ne saute ni ne répète aucune ligne.
      const { data, error } = await query.order("id", { ascending: true }).range(from, from + 999);
      if (error) throw new Error(`${table} : ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows.map((r) => fromRow(kind, r));
  }

  async function load(kind) {
    try {
      cache[kind] = await fetchAll(kind);
      return true;
    } catch (err) {
      console.error("Erreur de chargement :", err.message);
      return false;
    }
  }

  async function refresh() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    userId = session ? session.user.id : null;
    userEmail = session ? session.user.email : "";
    const results = await Promise.all(Object.keys(KINDS).map(load));
    return results.every(Boolean);
  }

  // ---- Écritures génériques (le cache est mis à jour sans tout recharger) ----

  async function insert(kind, obj, id) {
    const row = { user_id: userId, ...toRow(kind, obj) };
    if (id) row.id = id;
    const { data, error } = await supabaseClient.from(KINDS[kind].table).insert(row).select().single();
    if (error) {
      console.error(`Erreur d'enregistrement (${kind}) :`, error.message);
      return null;
    }
    const created = fromRow(kind, data);
    cache[kind].push(created);
    sortCache(kind);
    return created;
  }

  async function update(kind, id, changes) {
    const { data, error } = await supabaseClient.from(KINDS[kind].table).update(toRow(kind, changes)).eq("id", id).select().single();
    if (error) {
      console.error(`Erreur de modification (${kind}) :`, error.message);
      return null;
    }
    const updated = fromRow(kind, data);
    const index = cache[kind].findIndex((x) => x.id === id);
    if (index >= 0) cache[kind][index] = updated;
    sortCache(kind);
    return updated;
  }

  // « Supprimer » : la ligne reste en base avec archived_at, et sort du cache.
  async function archive(kind, id) {
    const { error } = await supabaseClient
      .from(KINDS[kind].table)
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error(`Erreur d'archivage (${kind}) :`, error.message);
      return false;
    }
    cache[kind] = cache[kind].filter((x) => x.id !== id);
    return true;
  }

  // ---- Opérations propres aux listes ----

  // Nouvel ordre des listes : seules les positions qui changent sont écrites.
  async function reorderLists(ids) {
    const changes = ids.map((id, position) => ({ id, position })).filter((c) => (cache.lists.find((l) => l.id === c.id) || {}).position !== c.position);
    const results = await Promise.all(
      changes.map((c) => supabaseClient.from(KINDS.lists.table).update({ position: c.position }).eq("id", c.id))
    );
    const failed = results.find((r) => r.error);
    if (failed) {
      console.error("Erreur de réorganisation :", failed.error.message);
      await load("lists");
      return false;
    }
    changes.forEach((c) => (cache.lists.find((l) => l.id === c.id).position = c.position));
    sortCache("lists");
    return true;
  }

  // Déplace tous les objets d'une liste vers une autre.
  async function moveItems(fromListId, toListId) {
    const { error } = await supabaseClient
      .from(KINDS.items.table)
      .update({ list_id: toListId })
      .eq("list_id", fromListId)
      .is("archived_at", null);
    if (error) {
      console.error("Erreur de déplacement :", error.message);
      return false;
    }
    cache.items.forEach((item) => {
      if (item.listId === fromListId) item.listId = toListId;
    });
    return true;
  }

  // Archive tous les objets d'une liste (quand on supprime la liste avec son contenu).
  async function archiveItemsOfList(listId) {
    const { error } = await supabaseClient
      .from(KINDS.items.table)
      .update({ archived_at: new Date().toISOString() })
      .eq("list_id", listId)
      .is("archived_at", null);
    if (error) {
      console.error("Erreur d'archivage :", error.message);
      return false;
    }
    cache.items = cache.items.filter((item) => item.listId !== listId);
    return true;
  }

  return {
    refresh,
    reorderLists,
    moveItems,
    archiveItemsOfList,
    insert,
    update,
    archive,
    lists: () => cache.lists,
    items: () => cache.items,
    list: (id) => cache.lists.find((l) => l.id === id) || null,
    item: (id) => cache.items.find((i) => i.id === id) || null,
    userId: () => userId,
    userEmail: () => userEmail,
  };
})();
