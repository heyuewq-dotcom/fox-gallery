# 狐之图库 Fox Gallery

本地优先的长期图库管理工具。原图留在用户本地，GitHub 保存程序、schema、文档和少量测试数据。现有 Starter ZIP 原样保留，不将后续图库提交 Git。

## 运行

需要 Node.js 22 或更新版本，无运行时依赖。

```powershell
# 首次解压：若目录已经存在，不要覆盖它
Expand-Archive Fox_Gallery_Codex_Starter_300.zip local-data/starter
npm start
```

打开 http://localhost:4173 。原始 Starter 预览位于 `/local-data/starter/index.html`，其中原图链接暂不可用，包内只有缩略图。请通过 HTTP 启动，不要双击 HTML。

## 数据目录

- `local-data/starter/`：被 Git 忽略的迁移验证数据，300 条记录、297 张缩略图。
- `src/`：v0.1 程序。
- `scripts/`：本地启动和 Starter 审计。
- 原始 ZIP：已有历史成果，保持不变。

当前阶段：v0.1 功能已完成。程序永远不自动删除原图和重复图。用户数据以 SHA-256 关联，独立于基础元数据保存。

## 使用

- 顶部搜索支持文件名、SHA-256、标签、分类和备注；分类/收藏/重复筛选可组合。
- 点击图片查看详情，编辑收藏、分类、逗号分隔标签和备注，点击“保存更改”。
- “多选”支持跨页选择、本页全选、批量分类、追加标签和收藏；标签追加保留原有标签。
- “导入图片”可选择多张图片、文件夹，或拖入图片/文件夹。支持 PNG、JPEG、WebP、GIF、BMP、AVIF、SVG，以当前浏览器能解码为准。
- 本地原图会计算 SHA-256；相同内容只显示一张卡片，详情中保留多个文件来源，不删除文件。
- 每次导入显示新增、已存在、更新、重复、错误、跳过和逐条错误。可取消导入，已成功保存的内容保留。
- “导入 manifest”支持 Starter JSON 数组、`{schemaVersion:1, images:[]}` 和 CSV。含 manifest 的整文件夹导入会关联 `original_rel` 与 `thumb`，不把缩略图当作原图。
- 同目录同时存在 `manifest.json` 与 `manifest.csv` 时采用 JSON。一个迁移目录建议只放一份有效 manifest；其他 JSON/CSV 会作为待导入索引校验。
- 导入单个 manifest 只导入索引；预览需要同时导入整个迁移目录，或以后选择本地原图。外部 manifest 不加载网络图片或任意绝对路径。

## 备份和恢复

“备份数据”导出用户 JSON：收藏、标签、分类、备注及其他用户字段，不包含原图、图片索引或目录权限。**原图文件夹必须独立备份。**

“恢复用户备份”先校验整份 JSON，再展示匹配/孤立/冲突数量。默认保留当前记录，也可选择用备份记录替换；不存在图片的用户数据仍保存，日后相同 hash 导入即关联。恢复及恢复前快照写入同一事务；“导出恢复前快照”可下载最近一次恢复之前的用户数据。

IndexedDB 按浏览器、用户配置和网站地址隔离；请保持 `http://localhost:4173` 地址和端口稳定。清理浏览器网站数据、隐私模式结束或浏览器存储回收可能移除索引/缩略图/用户数据，请定期导出用户备份。失败写入不会被报告为成功。

## 本地文件与兼容性

- 原图始终保留在原目录，不上传、不复制进 IndexedDB；数据库只存索引、用户字段、最长边 512px 的缩略图和可用的只读文件句柄。
- 普通文件选择或拖拽后，原图仅当前页面会话可读；刷新后可查看缓存缩略图，重新选择同一图片恢复原图访问。
- 支持 File System Access API 的浏览器可保存文件夹句柄，点击“重新连接文件夹”授权并重新扫描。权限被拒绝、文件移走或变更会给出提示，旧记录不会删除。
- 不支持目录句柄时降级为 `webkitdirectory`；手机也可使用批量文件选择。没有后台持续监听。
- SHA-256 依赖安全上下文：localhost 或 HTTPS。手机使用 HTTPS 部署程序文件即可；用普通 HTTP 的局域网 IP 访问时 SHA-256 会提示限制。当前服务默认只监听本机，不会自动开放公网或局域网。
- 单张图片暂限 150 MB，缩略图附件限 20 MB，manifest 限 40 MB，用户备份限 20 MB。散列按文件顺序计算，单次文件对象缓存散列结果；重新扫描目录会重新核对内容。
- Starter 包不含原图，3 个 SVG 没有预览。看到缩略图不代表已拿到原图。

## 架构与后续接口

`src/model.js` 管理内容主键、来源合并和筛选；`store.js` 提供 IndexedDB 事务；`backup.js` 校验/迁移用户备份；`manifest.js` 处理 JSON/CSV/迁移包；`importer.js` 接收 `AsyncIterable<{file?, handle?, path, origin?}>`。未来 Forge/Tauri/Electron 监听器只需提供该文件流，无须改写用户数据层。

数据库版本是 2（v1 建立 images/users/settings，v2 增加 assets/sources，不删旧表）；交换 JSON 的 `schemaVersion` 是 1。两者独立演进。用户备份版本 0 的 `notes` 可迁移为 `note`；未知未来版本拒绝写入。

网格每页最多 60 张、图片懒加载，搜索/筛选在轻量元数据上执行。约 2000 条数据已做浏览器验收；真正数 GB 原图不会一次载入内存。

## 开发与验证

日常运行 `npm start` 不需要安装依赖。开发验证需要 Node.js 22+：

```powershell
npm ci
npm test
npm run audit:starter
npm run format:check
npx playwright install chromium
# 另一个终端保持 npm start 运行
npm run test:browser
```

Windows 已安装 Edge 时，可设置 `$env:BROWSER_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'` 后运行浏览器测试，无须另下载 Chromium。测试使用隔离浏览器上下文，不修改日常图库；临时结果放在 Git 忽略的 `test-results/`。

实际验收见 `PROGRESS.md`；长期计划见 `PLAN.md`。新增迁移批次应放在 Git 忽略的本地目录，禁止将未来完整图库或个人备份提交 Git。
