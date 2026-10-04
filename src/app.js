import { GalleryIndex } from "./gallery-index.js";
import { virtualWindow } from "./virtual.js";
import { openStore } from "./store.js";
import { makeBackup, validateBackup, restoreSummary } from "./backup.js";
import { directoryEntries, droppedEntries, reportStats } from "./importer.js";
import { hashFile } from "./media.js";
import { importSelection, importManifest, parseManifest } from "./manifest.js";
import { ThumbnailCache } from "./thumbnails.js";
import { detailPatch, formatFileSize } from "./detail.js";
import { emptyUser, categoryOf, isDuplicate, parseTags } from "./model.js";

const $ = (id) => document.getElementById(id);
const state = {
  images: new Map(),
  users: new Map(),
  selected: new Set(),
  filter: "all",
  page: 0,
  selecting: false,
  active: null,
  busy: false,
  layout: "grid",
};
const PAGE_SIZE = 60;
let index = new GalleryIndex();
function setImage(image) {
  state.images.set(image.sha256, image);
  index.upsert(image, userFor(image.sha256));
}
function setUser(user) {
  state.users.set(user.sha256, user);
  const image = state.images.get(user.sha256);
  if (image) index.upsert(image, user);
}
let visibleRows = [];
let filterKey = "";
let store;
const thumbnails = new ThumbnailCache((hash) => store.get("assets", hash));
const cards = new Map();
const thumbnailObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              thumbnailObserver.unobserve(entry.target);
              loadCardThumbnail(entry.target);
            }
        },
        { rootMargin: "300px" },
      )
    : null;
const sessionFiles = new Map();
let detailUrl = null,
  importController = null;
let detailOrder = [],
  detailBaseline = null,
  detailGeneration = 0;
let detailSaving = null,
  pendingDetailAction = null;
function message(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function element(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function userFor(hash) {
  return state.users.get(hash) || emptyUser();
}
function filtered() {
  return index.query({
    query: $("search").value,
    category: $("category-filter").value,
    filter: state.filter,
    tags: parseTags($("tag-filter").value),
    tagMode: $("tag-mode").value,
  });
}

async function thumbnail(image) {
  return thumbnails.get(image.sha256, image.thumbnail);
}
function previewPlaceholder(text = "暂无预览") {
  const placeholder = element("div", undefined, "placeholder");
  placeholder.append(element("b", "◇"), element("small", text));
  return placeholder;
}
async function loadCardThumbnail(card) {
  const image = card.record;
  const open = card.querySelector(".image-button");
  try {
    const url = await thumbnail(image);
    if (!card.isConnected || card.record !== image) return;
    if (!url) {
      open.replaceChildren(previewPlaceholder());
      return;
    }
    const img = element("img");
    img.alt = image.filename;
    img.loading = "lazy";
    img.decoding = "async";
    img.width = image.width || 512;
    img.height = image.height || 512;
    img.onerror = () => {
      if (card.record !== image) return;
      const fallback = previewPlaceholder("预览加载失败");
      open.replaceChildren(fallback);
      const retry = card.querySelector(".retry-preview");
      retry.hidden = false;
    };
    img.src = url;
    open.replaceChildren(img);
  } catch {
    if (card.isConnected && card.record === image) {
      open.replaceChildren(previewPlaceholder("预览读取失败"));
      card.querySelector(".retry-preview").hidden = false;
    }
  }
}
function createCard(hash) {
  const card = element("article", undefined, "card");
  card.dataset.hash = hash;
  const open = element("button", undefined, "image-button");
  open.onclick = () =>
    state.selecting ? toggleSelect(hash) : openDetail(hash);
  const controls = element("div", undefined, "card-controls");
  const label = element("label", undefined, "select-check"),
    check = element("input");
  check.type = "checkbox";
  check.onchange = () => toggleSelect(hash);
  label.append(check);
  const heart = element("button", undefined, "heart");
  heart.onclick = async () => {
    heart.disabled = true;
    await saveUsers([hash], { favorite: !userFor(hash).favorite });
    heart.disabled = false;
  };
  controls.append(label, heart);
  const meta = element("div", undefined, "card-meta");
  meta.append(
    element("p", undefined, "card-title"),
    element("div", undefined, "pills"),
  );
  const retry = element("button", "重新加载预览", "retry-preview");
  retry.hidden = true;
  retry.onclick = () => {
    retry.hidden = true;
    thumbnails.invalidate(hash);
    loadCardThumbnail(card);
  };
  card.append(open, controls, meta, retry);
  return card;
}
function refreshCategories() {
  const selected = $("category-filter").value;
  const categories = [
    ...new Set(
      [...state.images.values()].map((i) => categoryOf(i, userFor(i.sha256))),
    ),
  ].sort();
  $("category-filter").replaceChildren(
    new Option("全部分类", ""),
    ...categories.map((c) => new Option(c, c)),
  );
  if (categories.includes(selected)) $("category-filter").value = selected;
  $("categories").replaceChildren(...categories.map((c) => new Option(c, c)));
}
function render() {
  const focusedCardControl = $("grid").contains(document.activeElement)
    ? document.activeElement
    : null;
  const rows = filtered();
  state.page = Math.max(
    0,
    Math.min(state.page, Math.ceil(rows.length / PAGE_SIZE) - 1),
  );
  $("total").textContent = state.images.size.toLocaleString();
  $("result-count").textContent =
    `${rows.length} 张图片 · ${index.sourceCount} 个文件来源`;
  $("empty").hidden = rows.length > 0;
  let pageRows = rows.slice(
    state.page * PAGE_SIZE,
    (state.page + 1) * PAGE_SIZE,
  );
  const viewport = $("gallery-viewport"),
    virtual = state.layout === "virtual";
  viewport.classList.toggle("virtual-viewport", virtual);
  const nextKey = JSON.stringify([
    $("search").value,
    $("category-filter").value,
    state.filter,
    $("tag-filter").value,
    $("tag-mode").value,
    state.layout,
  ]);
  if (nextKey !== filterKey) {
    viewport.scrollTop = 0;
    filterKey = nextKey;
  }
  const geometry = virtualWindow(
    rows.length,
    viewport.clientWidth,
    viewport.clientHeight,
    viewport.scrollTop,
  );
  if (virtual) {
    pageRows = rows.slice(geometry.start, geometry.end);
    viewport.scrollTop = geometry.top;
  }
  visibleRows = pageRows;
  $("grid").style.height = virtual ? geometry.totalHeight + "px" : "";
  document.querySelector(".pager").hidden = virtual;
  $("select-page").textContent = virtual ? "选择当前加载图片" : "选择本页";
  const keep = new Set(pageRows.map((image) => image.sha256));
  for (const [hash, card] of cards)
    if (!keep.has(hash)) {
      thumbnailObserver?.unobserve(card);
      card.remove();
      cards.delete(hash);
    }
  if (state.active) keep.add(state.active);
  thumbnails.retain(keep);
  $("grid").dataset.layout = state.layout;
  const fragment = document.createDocumentFragment();
  const observed = [];
  for (const image of pageRows) {
    const hash = image.sha256,
      user = userFor(hash);
    const card = cards.get(hash) || createCard(hash);
    cards.set(hash, card);
    card.classList.toggle("selected", state.selected.has(hash));
    const open = card.querySelector(".image-button");
    open.setAttribute("aria-label", `查看 ${image.filename}`);
    open.style.setProperty(
      "--image-ratio",
      `${image.width || 1} / ${image.height || 1}`,
    );
    if (card.record !== image) {
      card.record = image;
      open.replaceChildren(previewPlaceholder("等待预览"));
      card.querySelector(".retry-preview").hidden = true;
      observed.push(card);
    }
    card.querySelector(".select-check").hidden = !state.selecting;
    const check = card.querySelector("input");
    check.checked = state.selected.has(hash);
    check.setAttribute("aria-label", `选择 ${image.filename}`);
    const heart = card.querySelector(".heart");
    heart.textContent = user.favorite ? "♥" : "♡";
    heart.setAttribute(
      "aria-label",
      `${user.favorite ? "取消收藏" : "收藏"} ${image.filename}`,
    );
    heart.setAttribute("aria-pressed", String(user.favorite));
    const title = card.querySelector(".card-title");
    title.textContent = image.filename;
    title.title = image.filename;
    const pills = card.querySelector(".pills");
    pills.replaceChildren();
    pills.append(element("span", categoryOf(image, user), "pill"));
    if (isDuplicate(image))
      pills.append(
        element("span", `重复 · ${image.sources.length}`, "pill duplicate"),
      );
    for (const tag of user.tags.slice(0, 2))
      pills.append(element("span", `#${tag}`, "pill"));
    if (virtual) {
      const position = geometry.start + pageRows.indexOf(image);
      card.style.position = "absolute";
      card.style.width = geometry.cardWidth + "px";
      card.style.height = geometry.cardHeight + "px";
      card.style.left =
        (position % geometry.columns) * (geometry.cardWidth + geometry.gap) +
        "px";
      card.style.top =
        Math.floor(position / geometry.columns) * geometry.rowHeight + "px";
    } else card.removeAttribute("style");
    fragment.append(card);
  }
  $("grid").replaceChildren(fragment);
  if (focusedCardControl) {
    (focusedCardControl.isConnected ? focusedCardControl : viewport).focus({
      preventScroll: true,
    });
  }
  for (const card of observed)
    if (thumbnailObserver) thumbnailObserver.observe(card);
    else loadCardThumbnail(card);
  $("page-label").textContent =
    `${state.page + 1} / ${Math.max(1, Math.ceil(rows.length / PAGE_SIZE))}`;
  $("previous").disabled = !state.page;
  $("next").disabled = (state.page + 1) * PAGE_SIZE >= rows.length;
  document
    .querySelectorAll("[data-filter]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter)),
    );
  $("select-mode").setAttribute("aria-pressed", String(state.selecting));
  $("batch").hidden = !state.selecting;
  $("selection-count").textContent = `已选 ${state.selected.size} 张`;
}
function toggleSelect(hash) {
  state.selected.has(hash)
    ? state.selected.delete(hash)
    : state.selected.add(hash);
  render();
}
async function saveUsers(hashes, patch) {
  try {
    const rows = await store.updateUsers(hashes, patch);
    for (const row of rows) setUser(row);
    refreshCategories();
    render();
    return true;
  } catch (error) {
    const text = `保存失败：${error.message}。现有数据未改变。`;
    message(text, true);
    $("save-hint").textContent = text;
    if ($("batch-dialog").open) $("batch-description").textContent = text;
    return false;
  }
}
function detailDraft() {
  return {
    favorite: $("favorite").checked,
    category: $("edit-category").value.trim(),
    tags: parseTags($("edit-tags").value),
    note: $("edit-note").value,
  };
}
function detailDirty() {
  return Boolean(
    state.active &&
    detailBaseline &&
    Object.keys(detailPatch(detailBaseline, detailDraft())).length,
  );
}
function updateDetailNavigation() {
  const index = detailOrder.indexOf(state.active);
  $("detail-position").textContent = `${index + 1} / ${detailOrder.length}`;
  $("detail-previous").disabled = Boolean(detailSaving) || index <= 0;
  $("detail-next").disabled =
    Boolean(detailSaving) || index >= detailOrder.length - 1;
}
function setZoom(zoomed) {
  $("preview-viewport").classList.toggle("zoomed", zoomed);
  $("detail-zoom").setAttribute("aria-pressed", String(zoomed));
  $("detail-zoom").textContent = zoomed ? "适应窗口" : "实际尺寸";
  $("preview-viewport").scrollTo(0, 0);
}
function setDetailPreview(url, hint, generation) {
  if (generation !== detailGeneration || !state.active) return;
  const img = $("detail-image");
  img.hidden = !url;
  $("detail-zoom").disabled = !url;
  img.onerror = () => {
    if (generation !== detailGeneration) return;
    img.hidden = true;
    $("detail-zoom").disabled = true;
    $("preview-hint").textContent = "预览无法读取，可重新选择本地原图。";
  };
  if (url) img.src = url;
  else img.removeAttribute("src");
  $("preview-hint").textContent = hint;
}
async function displayOriginal(file, hash, generation) {
  if (file.size > 150 * 1024 * 1024)
    throw new Error("原图超过单文件 150 MB 上限");
  if ((await hashFile(file)) !== hash)
    throw new Error("所选文件的 SHA-256 不匹配，原有图片和编辑未更改");
  if (generation !== detailGeneration || state.active !== hash) return;
  if (detailUrl) URL.revokeObjectURL(detailUrl);
  detailUrl = URL.createObjectURL(file);
  sessionFiles.set(hash, file);
  setDetailPreview(detailUrl, "本地原图", generation);
}
function openDetail(hash) {
  detailOrder = filtered().map((image) => image.sha256);
  showDetail(hash);
}
async function showDetail(hash) {
  const generation = ++detailGeneration;
  if (detailUrl) URL.revokeObjectURL(detailUrl);
  detailUrl = null;
  state.active = hash;
  const image = state.images.get(hash),
    user = userFor(hash);
  thumbnails.retain(new Set([...cards.keys(), hash]));
  setZoom(false);
  setDetailPreview("", "正在读取预览…", generation);
  $("detail-name").textContent = image.filename;
  $("detail-image").alt = image.filename;
  $("favorite").checked = user.favorite;
  $("edit-category").value = categoryOf(image, user);
  $("edit-tags").value = user.tags.join(", ");
  $("edit-note").value = user.note;
  detailBaseline = detailDraft();
  $("save-hint").textContent = "";
  $("metadata").replaceChildren();
  for (const [label, value] of [
    ["SHA-256", hash],
    [
      "尺寸",
      image.width && image.height
        ? `${image.width} × ${image.height}`
        : "未提供",
    ],
    ["文件大小", formatFileSize(image.fileSize)],
    ["MIME", image.mimeType || "未提供"],
    ["来源", image.source],
    [
      "重复组",
      image.duplicateGroup ||
        (isDuplicate(image) ? "相同内容的多个来源" : "无"),
    ],
  ])
    $("metadata").append(element("dt", label), element("dd", value));
  $("sources").replaceChildren(
    ...image.sources.map((s) =>
      element("li", `${s.path} · ${s.origin}${s.batch ? " · " + s.batch : ""}`),
    ),
  );
  updateDetailNavigation();
  if (!$("detail").open) $("detail").showModal();
  $("detail").scrollTop = 0;
  try {
    const url = await thumbnail(image);
    setDetailPreview(
      url,
      url
        ? "缩略图预览 · 可选择本地原图查看完整尺寸"
        : "暂无预览 · 可重新选择本地原图",
      generation,
    );
  } catch (e) {
    if (generation === detailGeneration)
      $("preview-hint").textContent = `缩略图读取失败：${e.message}`;
  }
  if (generation !== detailGeneration) return;
  try {
    let file = sessionFiles.get(hash);
    if (!file) {
      const asset = await store.get("assets", hash);
      if (asset?.handle) {
        if (
          (await asset.handle.queryPermission({ mode: "read" })) === "granted"
        )
          file = await asset.handle.getFile();
        else if (generation === detailGeneration)
          $("preview-hint").textContent =
            "原图目录需重新授权；可在这里选择原图，或在导入入口重新连接文件夹。";
      }
    }
    if (file) await displayOriginal(file, hash, generation);
  } catch (e) {
    if (generation === detailGeneration)
      $("preview-hint").textContent =
        `原图暂不可用：${e.message}。可重新选择本地原图。`;
  }
}
async function saveDetail() {
  if (detailSaving) return detailSaving;
  const hash = state.active,
    draft = detailDraft(),
    patch = detailPatch(detailBaseline, draft);
  if (!Object.keys(patch).length) {
    $("save-hint").textContent = "已保存";
    return true;
  }
  const controls = [
    ...$("detail-form").querySelectorAll("input, textarea, button"),
  ];
  controls.forEach((control) => (control.disabled = true));
  $("detail-close").disabled = true;
  $("save-hint").textContent = "正在保存…";
  detailSaving = saveUsers([hash], patch);
  updateDetailNavigation();
  try {
    const saved = await detailSaving;
    if (saved) {
      detailBaseline = draft;
      $("save-hint").textContent = "已保存";
    }
    return saved;
  } finally {
    detailSaving = null;
    controls.forEach((control) => (control.disabled = false));
    $("detail-close").disabled = false;
    updateDetailNavigation();
  }
}
async function requestDetailAction(action) {
  if (detailSaving && !(await detailSaving)) return;
  if (detailDirty()) {
    pendingDetailAction = action;
    $("unsaved-message").textContent =
      "关闭详情或切换图片前，请选择如何处理当前编辑。";
    if (!$("unsaved-dialog").open) $("unsaved-dialog").showModal();
    return;
  }
  action();
}
function navigateDetail(direction) {
  const target = detailOrder[detailOrder.indexOf(state.active) + direction];
  if (target) requestDetailAction(() => showDetail(target));
}
async function loadStarter() {
  if (state.busy) return message("请等待当前导入完成");
  state.busy = true;
  try {
    message("正在载入 Starter…");
    const response = await fetch("local-data/starter/manifest.json");
    if (!response.ok)
      throw new Error("请先按 README 解压 Starter ZIP，或选择本地图片");
    const records = parseManifest(await response.text());
    const stats = await importManifest(records, {
      store,
      thumbnailURL: (row) =>
        row.thumb
          ? "local-data/starter/thumbs/" + encodeURIComponent(row.thumb)
          : "",
      onImported: (image) => setImage(image),
    });
    refreshCategories();
    render();
    $("import-report").textContent = reportStats(stats);
    message(
      `Starter 已载入：${records.length} 条来源，${state.images.size} 张独立图片。3 条 SVG 没有缩略图。`,
    );
  } catch (e) {
    message(e.message, true);
    $("import-report").textContent = e.message;
  } finally {
    state.busy = false;
  }
}
$("search").oninput = () => {
  state.page = 0;
  render();
};
$("category-filter").onchange = () => {
  state.page = 0;
  render();
};
for (const id of ["tag-filter", "tag-mode"])
  $(id).addEventListener(id === "tag-filter" ? "input" : "change", () => {
    state.page = 0;
    render();
  });
$("clear-filters").onclick = () => {
  $("search").value = "";
  $("category-filter").value = "";
  $("tag-filter").value = "";
  $("tag-mode").value = "all";
  state.filter = "all";
  state.page = 0;
  render();
};
$("layout").onchange = async () => {
  state.layout = $("layout").value;
  render();
  try {
    await store.put("settings", { id: "gallery-view", layout: state.layout });
  } catch (e) {
    message(`布局偏好未保存：${e.message}`, true);
  }
};
document.querySelectorAll("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      state.filter = b.dataset.filter;
      state.page = 0;
      render();
    }),
);
$("previous").onclick = () => {
  state.page--;
  render();
};
$("next").onclick = () => {
  state.page++;
  render();
  window.scrollTo({ top: 0 });
};
$("detail-close").onclick = () =>
  requestDetailAction(() => $("detail").close());
$("detail-previous").onclick = () => navigateDetail(-1);
$("detail-next").onclick = () => navigateDetail(1);
$("detail").addEventListener("cancel", (event) => {
  event.preventDefault();
  requestDetailAction(() => $("detail").close());
});
$("detail").addEventListener("keydown", (event) => {
  if (
    event.target.closest("input, textarea, select, [contenteditable=true]") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    navigateDetail(event.key === "ArrowLeft" ? -1 : 1);
  }
});
$("detail").addEventListener("close", () => {
  const hash = state.active;
  ++detailGeneration;
  state.active = null;
  detailBaseline = null;
  if (detailUrl) URL.revokeObjectURL(detailUrl);
  detailUrl = null;
  $("detail-image").removeAttribute("src");
  const index = filtered().findIndex((image) => image.sha256 === hash);
  if (index >= 0) {
    state.page = Math.floor(index / PAGE_SIZE);
    if (state.layout === "virtual") {
      const g = virtualWindow(
        filtered().length,
        $("gallery-viewport").clientWidth,
        $("gallery-viewport").clientHeight,
        0,
      );
      $("gallery-viewport").scrollTop =
        Math.floor(index / g.columns) * g.rowHeight;
    }
  }
  render();
  (cards.get(hash)?.querySelector(".image-button") || $("search")).focus({
    preventScroll: true,
  });
});
$("detail-form").onsubmit = async (e) => {
  e.preventDefault();
  await saveDetail();
};
$("detail-form").oninput = () =>
  ($("save-hint").textContent = detailDirty() ? "尚未保存" : "");
$("unsaved-stay").onclick = () => {
  pendingDetailAction = null;
  $("unsaved-dialog").close();
};
$("unsaved-dialog").addEventListener("cancel", () => {
  pendingDetailAction = null;
});
$("unsaved-discard").onclick = () => {
  const action = pendingDetailAction;
  pendingDetailAction = null;
  $("unsaved-dialog").close();
  action?.();
};
$("unsaved-save").onclick = async () => {
  const buttons = [...$("unsaved-dialog").querySelectorAll("button")];
  buttons.forEach((button) => (button.disabled = true));
  try {
    if (await saveDetail()) {
      const action = pendingDetailAction;
      pendingDetailAction = null;
      $("unsaved-dialog").close();
      action?.();
    } else $("unsaved-message").textContent = $("save-hint").textContent;
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
};
window.addEventListener("beforeunload", (event) => {
  if (detailDirty()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
$("detail-zoom").onclick = () =>
  setZoom($("detail-zoom").getAttribute("aria-pressed") !== "true");
$("detail-relink").onclick = () => $("detail-file-input").click();
$("detail-file-input").onchange = async (event) => {
  const file = event.target.files[0],
    hash = state.active;
  event.target.value = "";
  if (!file || !hash) return;
  const generation = ++detailGeneration;
  $("preview-hint").textContent = "正在验证原图 SHA-256…";
  try {
    await displayOriginal(file, hash, generation);
  } catch (e) {
    if (generation === detailGeneration)
      $("preview-hint").textContent = e.message;
  }
};
$("starter").onclick = loadStarter;
$("load-starter").onclick = loadStarter;
$("import-open").onclick = () => $("import-dialog").showModal();
$("import-close").onclick = () => $("import-dialog").close();
$("select-mode").onclick = () => {
  state.selecting = !state.selecting;
  if (!state.selecting) state.selected.clear();
  render();
};
let batchMode = "category";
function openBatch(mode) {
  if (!state.selected.size) {
    message("请先选择图片");
    return;
  }
  batchMode = mode;
  const labels = {
    category: "设置分类",
    tags: "添加标签",
    removeTags: "移除标签",
    replaceTags: "替换全部标签",
  };
  $("batch-title").textContent = `批量${labels[mode]}`;
  $("batch-description").textContent =
    `将修改 ${state.selected.size} 张图片。${mode === "replaceTags" ? "全部旧标签将被替换；留空会清空标签。" : mode === "tags" ? "现有标签将保留。" : "其他字段保持不变。"}`;
  $("batch-value").value = "";
  $("batch-value").required = mode !== "replaceTags";
  $("batch-value").maxLength = mode === "category" ? 120 : 2000;
  $("batch-label").textContent =
    mode === "category" ? "分类名称" : "标签（逗号分隔）";
  $("batch-dialog").showModal();
}
$("batch-category").onclick = () => openBatch("category");
$("batch-tags").onclick = () => openBatch("tags");
$("batch-remove-tags").onclick = () => openBatch("removeTags");
$("batch-replace-tags").onclick = () => openBatch("replaceTags");
$("batch-favorite").onclick = async () => {
  if (!state.selected.size) return message("请先选择图片");
  if (await saveUsers([...state.selected], { favorite: true }))
    message(`已收藏 ${state.selected.size} 张图片`);
};
$("batch-cancel").onclick = () => $("batch-dialog").close();
$("batch-form").onsubmit = async (e) => {
  e.preventDefault();
  const value = $("batch-value").value.trim();
  if (!value && batchMode !== "replaceTags") return;
  const patch =
    batchMode === "category"
      ? { category: value }
      : {
          [{ tags: "addTags", removeTags: "removeTags", replaceTags: "tags" }[
            batchMode
          ]]: parseTags(value),
        };
  if (await saveUsers([...state.selected], patch)) {
    $("batch-dialog").close();
    message(`已更新 ${state.selected.size} 张图片`);
  }
};
$("select-page").onclick = () => {
  for (const i of visibleRows) state.selected.add(i.sha256);
  render();
};
$("clear-selection").onclick = () => {
  state.selected.clear();
  state.selecting = false;
  render();
};
function downloadJSON(data, name) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    a = element("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$("backup").onclick = async () => {
  try {
    downloadJSON(
      makeBackup(await store.all("users")),
      `fox-gallery-users-${new Date().toISOString().slice(0, 10)}.json`,
    );
    message("用户数据备份已导出（不包含原图）。");
  } catch (e) {
    message(e.message, true);
  }
};
let pendingRestore = [];
$("pick-restore").onclick = () => $("restore-input").click();
$("restore-input").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error("备份超过 20 MB 限制");
    pendingRestore = validateBackup(JSON.parse(await file.text()));
    const summary = restoreSummary(pendingRestore, state.images, state.users);
    $("restore-summary").textContent =
      `共 ${summary.total} 条，匹配图片 ${summary.matched} 条，孤立用户数据 ${summary.orphans} 条，已有用户记录 ${summary.conflicts} 条。`;
    $("restore-mode").value = "keep";
    $("restore-dialog").showModal();
  } catch (e) {
    $("import-report").textContent = `恢复校验失败：${e.message}`;
  }
};
$("restore-cancel").onclick = () => {
  $("restore-dialog").close();
  pendingRestore = [];
};
$("restore-apply").onclick = async () => {
  const button = $("restore-apply");
  button.disabled = true;
  try {
    const result = await store.restoreUsers(
      pendingRestore,
      $("restore-mode").value === "replace",
    );
    state.users = new Map((await store.all("users")).map((u) => [u.sha256, u]));
    index = new GalleryIndex();
    for (const image of state.images.values())
      index.upsert(image, userFor(image.sha256));
    refreshCategories();
    render();
    $("restore-dialog").close();
    $("import-report").textContent =
      `已恢复 ${result.restored} 条，保留当前记录 ${result.kept} 条。`;
    pendingRestore = [];
  } catch (e) {
    $("restore-summary").textContent = `恢复失败：${e.message}`;
  } finally {
    button.disabled = false;
  }
};
$("export-snapshot").onclick = async () => {
  try {
    const snapshot = await store.get("settings", "before-last-restore");
    if (!snapshot) {
      $("import-report").textContent = "尚无恢复前快照。";
      return;
    }
    downloadJSON(snapshot.backup, "fox-gallery-before-restore.json");
    $("import-report").textContent = "已导出最近一次恢复前快照。";
  } catch (e) {
    $("import-report").textContent = e.message;
  }
};
async function runImport(entries, total = 0) {
  if (state.busy) {
    message("请等待当前导入完成", true);
    return;
  }
  state.busy = true;
  importController = new AbortController();
  $("cancel-import").hidden = false;
  if (!$("import-dialog").open) $("import-dialog").showModal();
  $("import-progress").value = 0;
  $("import-progress").max = total || 1;
  $("import-report").textContent = "正在扫描所选文件…";
  try {
    const stats = await importSelection(entries, {
      store,
      signal: importController.signal,
      onProgress: (s) => {
        $("import-report").textContent = reportStats(s);
        if (total) {
          $("import-progress").max = Math.max(total, s.processed);
          $("import-progress").value = s.processed;
        } else $("import-progress").removeAttribute("value");
      },
      onImported: (image, file) => {
        setImage(image);
        if (file) sessionFiles.set(image.sha256, file);
        thumbnails.invalidate(image.sha256);
      },
    });
    $("import-progress").max = 1;
    $("import-progress").value = 1;
    message(
      `导入结束：新增 ${stats.added}，已存在 ${stats.existing}，错误 ${stats.errors}`,
    );
  } catch (e) {
    $("import-report").textContent +=
      `\n导入中止：${e.message}。已成功写入的记录保留。`;
    message(e.message, true);
  } finally {
    state.busy = false;
    $("cancel-import").hidden = true;
    refreshCategories();
    render();
  }
}
$("pick-files").onclick = () => $("files-input").click();
$("files-input").onchange = (e) => {
  const entries = [...e.target.files].map((file) => ({
    file,
    path: file.name,
  }));
  e.target.value = "";
  runImport(entries, entries.length);
};
$("directory-input").onchange = (e) => {
  const entries = [...e.target.files].map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
  e.target.value = "";
  runImport(entries, entries.length);
};
$("pick-directory").onclick = async () => {
  if (!window.showDirectoryPicker) {
    $("directory-input").click();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    let source;
    for (const known of await store.all("sources")) {
      try {
        if (await known.handle.isSameEntry(handle)) {
          source = known;
          break;
        }
      } catch {}
    }
    source = source || { id: crypto.randomUUID(), name: handle.name, handle };
    await store.put("sources", source);
    await runImport(directoryEntries(handle, handle.name, source.id));
  } catch (e) {
    if (e.name !== "AbortError") {
      $("import-report").textContent =
        `文件夹权限不可用：${e.message}。改用普通文件夹选择。`;
      $("directory-input").click();
    }
  }
};
$("reconnect").onclick = async () => {
  try {
    const sources = await store.all("sources");
    if (!sources.length) {
      $("import-report").textContent =
        "没有保存的目录。请选择文件夹或重新选择原图。";
      return;
    }
    for (const source of sources) {
      if (
        (await source.handle.requestPermission({ mode: "read" })) === "granted"
      )
        await runImport(
          directoryEntries(source.handle, source.name, source.id),
        );
      else
        $("import-report").textContent =
          `未授权文件夹 ${source.name}。已有索引和缩略图仍保留。`;
    }
  } catch (e) {
    $("import-report").textContent =
      `重新连接失败：${e.message}。请重新选择文件夹。`;
  }
};
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    dragDepth++;
    document.body.classList.add("dragging");
  }
});
window.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) e.preventDefault();
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) document.body.classList.remove("dragging");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const items = [...e.dataTransfer.items]
    .filter((i) => i.kind === "file")
    .map((i) => ({ entry: i.webkitGetAsEntry?.(), file: i.getAsFile() }));
  runImport(droppedEntries(items));
});
$("pick-manifest").onclick = () => $("manifest-input").click();
$("cancel-import").onclick = () => importController?.abort();
$("manifest-input").onchange = (e) => {
  const entries = [...e.target.files].map((file) => ({
    file,
    path: file.name,
  }));
  e.target.value = "";
  runImport(entries);
};
try {
  store = await openStore();
  const view = await store.get("settings", "gallery-view");
  state.layout = ["masonry", "virtual"].includes(view?.layout)
    ? view.layout
    : "grid";
  $("layout").value = state.layout;
  for (const i of await store.all("images")) setImage(i);
  for (const u of await store.all("users")) setUser(u);
  refreshCategories();
  render();
  if (!state.images.size) await loadStarter();
} catch (e) {
  message(`无法启动存储：${e.message}`, true);
}

let viewportFrame;
function renderViewport() {
  if (state.layout !== "virtual") return;
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(render);
}
$("gallery-viewport").addEventListener("scroll", renderViewport, {
  passive: true,
});
new ResizeObserver(renderViewport).observe($("gallery-viewport"));
