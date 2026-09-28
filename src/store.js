// Temporary in-memory adapter, replaced in the persistence phase.
export async function openStore() {
  const data = {images:new Map(),users:new Map(),assets:new Map(),sources:new Map(),settings:new Map()};
  return {
    async all(name) { return [...data[name].values()]; },
    async get(name,key) { return data[name].get(key); },
    async put(name,value) { data[name].set(value.sha256 || value.id,value); },
    async putMany(name,values) { for (const v of values) data[name].set(v.sha256 || v.id,v); }
  };
}
