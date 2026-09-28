import { normalizeRecord, mergeImage } from "./model.js";
import { supportedImage, mimeFor, hashFile, createThumbnail } from "./media.js";
export const newStats = () => ({
  added: 0,
  existing: 0,
  updated: 0,
  duplicates: 0,
  errors: 0,
  skipped: 0,
  processed: 0,
  details: [],
});
export const reportStats = (s) =>
  `新增 ${s.added} · 已存在 ${s.existing} · 更新 ${s.updated}\n重复 ${s.duplicates} · 错误 ${s.errors} · 跳过 ${s.skipped}\n已处理 ${s.processed}${s.cancelled ? "（已取消，已保存的记录保留）" : ""}\n${s.details.join("\n")}`;
// Shared adapter contract: async iterable of {file, path, handle?, origin?}.
// A future Forge/Tauri directory watcher supplies this same stream.
export async function importFiles(
  entries,
  { store, onProgress = () => {}, onImported = () => {}, signal } = {},
) {
  const stats = newStats();
  for await (const entry of entries) {
    if (signal?.aborted) {
      stats.cancelled = true;
      break;
    }
    let file = entry.file;
    try {
      if (entry.error) throw new Error(entry.error);
      if (!file && entry.handle) file = await entry.handle.getFile();
      if (!file) throw new Error("无法读取文件");
      if (!supportedImage(file)) {
        stats.skipped++;
        continue;
      }
      if (file.size > 150 * 1024 * 1024)
        throw new Error("超过单文件 150 MB 上限，请分辨率调整后导入");
      const sha256 = await hashFile(file);
      let previous = await store.get("images", sha256);
      const oldAsset = await store.get("assets", sha256);
      const media = oldAsset?.thumbnail
        ? {
            width: previous?.width,
            height: previous?.height,
            thumbnail: oldAsset.thumbnail,
          }
        : await createThumbnail(file);
      const next = normalizeRecord(
        {
          sha256,
          filename: file.name,
          filePath: entry.path || file.webkitRelativePath || file.name,
          fileSize: file.size,
          mimeType: mimeFor(file),
          width: media.width,
          height: media.height,
          createdAt: new Date(file.lastModified || Date.now()).toISOString(),
        },
        { origin: entry.origin || "local" },
      );
      let merged = mergeImage(previous, next);
      const asset = {
        sha256,
        thumbnail: media.thumbnail,
        ...(entry.handle ? { handle: entry.handle } : {}),
      };
      if (store.mergeImage) {
        const result = await store.mergeImage(next, asset);
        previous = result.previous;
        merged = result.image;
      } else
        await store.write([
          ["images", [merged]],
          ["assets", [asset]],
        ]);
      if (previous) {
        stats.existing++;
        stats.duplicates++;
        if (JSON.stringify(previous) !== JSON.stringify(merged))
          stats.updated++;
      } else stats.added++;
      onImported(merged, file);
    } catch (e) {
      stats.errors++;
      stats.details.push(`${file?.name || entry.path || "文件"}：${e.message}`);
    } finally {
      stats.processed++;
      onProgress(stats);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress(stats);
  return stats;
}
export async function* directoryEntries(
  directory,
  prefix = "",
  origin = "local",
) {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      try {
        yield* directoryEntries(handle, path, origin);
      } catch (e) {
        yield { path, error: e.message };
      }
    } else yield { handle, path, origin };
  }
}
export async function* droppedEntries(items) {
  async function* walk(entry, prefix = "") {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      try {
        const file = await new Promise((resolve, reject) =>
          entry.file(resolve, reject),
        );
        yield { file, path, origin: "local" };
      } catch (e) {
        yield { path, error: e.message };
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      while (true) {
        const children = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!children.length) break;
        for (const child of children) yield* walk(child, path);
      }
    }
  }
  for (const item of items) {
    if (item.entry) yield* walk(item.entry);
    else if (item.file)
      yield { file: item.file, path: item.file.name, origin: "local" };
  }
}
