// Only the current page and the open detail keep blob URLs alive.
// A single in-flight read is shared by the card and its detail preview.
export class ThumbnailCache {
  constructor(
    readAsset,
    createURL = URL.createObjectURL,
    revokeURL = URL.revokeObjectURL,
  ) {
    this.readAsset = readAsset;
    this.createURL = createURL;
    this.revokeURL = revokeURL;
    this.entries = new Map();
  }
  get(hash, fallback = "") {
    if (this.entries.has(hash)) return this.entries.get(hash).promise;
    const entry = { active: true, url: null };
    entry.promise = Promise.resolve()
      .then(() => this.readAsset(hash))
      .then((asset) => {
        if (!entry.active) return "";
        if (asset?.thumbnail) entry.url = this.createURL(asset.thumbnail);
        return entry.url || fallback;
      })
      .catch((error) => {
        if (this.entries.get(hash) === entry) this.entries.delete(hash);
        throw error;
      });
    this.entries.set(hash, entry);
    return entry.promise;
  }
  invalidate(hash) {
    const entry = this.entries.get(hash);
    if (!entry) return;
    entry.active = false;
    if (entry.url) this.revokeURL(entry.url);
    this.entries.delete(hash);
  }
  retain(hashes) {
    for (const hash of this.entries.keys())
      if (!hashes.has(hash)) this.invalidate(hash);
  }
  clear() {
    this.retain(new Set());
  }
}
