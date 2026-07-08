// In-memory collections behind the mock routes.
//
// A mock with no state forces every front-end test to stub responses by hand.
// Keeping documents here means POST -> GET by id -> PATCH -> DELETE behaves
// like the real API, including 404 after delete. Everything resets with the
// process; that is a feature, not a missing database.

/** `tasks` -> `tsk`, `projects` -> `prj`: short readable ids in fixtures. */
export function idPrefix(name) {
  const letters = String(name || "item").toLowerCase().replace(/[^a-z]/g, "");
  const consonants = letters.replace(/[aeiou]/g, "");
  return (consonants || letters || "itm").slice(0, 3);
}

export function createStore({ seed = 7 } = {}) {
  const collections = new Map();
  const counters = new Map();

  function collection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name);
  }

  function nextId(name) {
    const next = (counters.get(name) || 0) + 1;
    counters.set(name, next);
    return `${idPrefix(name)}_${String(next).padStart(3, "0")}`;
  }

  return {
    nextId,
    seed(name, items) {
      const target = collection(name);
      for (const item of items) {
        const id = item && item.id !== undefined && item.id !== null ? item.id : nextId(name);
        target.set(String(id), { ...item, id });
      }
      return target.size;
    },
    insert(name, item) {
      const record = { ...(item || {}) };
      if (record.id === undefined || record.id === null || record.id === "") record.id = nextId(name);
      collection(name).set(String(record.id), record);
      return record;
    },
    get(name, id) {
      return collection(name).get(String(id)) || null;
    },
    list(name) {
      return [...collection(name).values()];
    },
    update(name, id, patch) {
      const existing = collection(name).get(String(id));
      if (!existing) return null;
      const updated = { ...existing, ...patch, id: existing.id };
      collection(name).set(String(id), updated);
      return updated;
    },
    remove(name, id) {
      return collection(name).delete(String(id));
    },
    clear(name) {
      if (name) collections.delete(name);
      else collections.clear();
    },
    reset() {
      collections.clear();
      counters.clear();
    },
    stats() {
      return [...collections.entries()]
        .map(([name, records]) => ({ name, count: records.size, prefix: idPrefix(name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
