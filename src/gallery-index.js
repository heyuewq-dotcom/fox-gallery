import { categoryOf, emptyUser, isDuplicate } from "./model.js";
const order = (a, b) =>
  b.importedAt.localeCompare(a.importedAt) || a.sha256.localeCompare(b.sha256);
// Rebuilt from compatible persisted records at startup; only changed hashes are reindexed.
export class GalleryIndex {
  constructor() {
    this.docs = new Map();
    this.facets = new Map();
    this.cache = null;
    this.sourceCount = 0;
  }
  upsert(image, user = emptyUser()) {
    const hash = image.sha256,
      previous = this.docs.get(hash);
    if (previous?.image === image && previous?.user === user) return;
    if (previous) {
      for (const key of previous.keys) {
        const set = this.facets.get(key);
        set.delete(hash);
        if (!set.size) this.facets.delete(key);
      }
      this.sourceCount -= previous.image.sources.length;
    }
    const category = categoryOf(image, user);
    const keys = [
      ...new Set([`category:${category}`, ...user.tags.map((t) => `tag:${t}`)]),
    ];
    if (user.favorite) keys.push("favorite");
    if (isDuplicate(image)) keys.push("duplicate");
    const text = [
      image.filename,
      hash,
      category,
      user.note,
      ...user.tags,
      ...image.sources.map((s) => s.filename),
    ]
      .join(" ")
      .toLocaleLowerCase();
    this.docs.set(hash, { image, user, keys, text });
    this.sourceCount += image.sources.length;
    for (const key of keys) {
      if (!this.facets.has(key)) this.facets.set(key, new Set());
      this.facets.get(key).add(hash);
    }
    this.cache = null;
  }
  query({
    query = "",
    category = "",
    filter = "all",
    tags = [],
    tagMode = "all",
  } = {}) {
    const key = JSON.stringify([query, category, filter, tags, tagMode]);
    if (this.cache?.key === key) return this.cache.rows;
    const groups = [];
    if (category)
      groups.push(this.facets.get(`category:${category}`) || new Set());
    if (filter !== "all") groups.push(this.facets.get(filter) || new Set());
    if (tags.length) {
      const sets = tags.map((t) => this.facets.get(`tag:${t}`) || new Set());
      if (tagMode === "any") groups.push(new Set(sets.flatMap((s) => [...s])));
      else groups.push(...sets);
    }
    groups.sort((a, b) => a.size - b.size);
    const candidates = groups.length ? groups[0] : this.docs.keys(),
      q = query.trim().toLocaleLowerCase(),
      rows = [];
    for (const hash of candidates) {
      const doc = this.docs.get(hash);
      if (groups.every((g) => g.has(hash)) && (!q || doc.text.includes(q)))
        rows.push(doc.image);
    }
    rows.sort(order);
    this.cache = { key, rows };
    return rows;
  }
}
