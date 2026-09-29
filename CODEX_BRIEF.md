# 后续 Codex 接手原则

- 继续 heyuewq-dotcom/fox-gallery，不重建项目、不 reset --hard、不重写历史、不删现有成果。
- 原图和重复图永久保留；GitHub 不存放未来数 GB 图库。
- SHA-256 为内容唯一键；同 hash 的多个文件来源全部保留。文件名绝不能作为用户数据键。
- 基础图片信息与收藏、标签、分类、备注分开存储。任何图片/manifest 导入不得覆盖用户字段。
- IndexedDB、schemaVersion、向后迁移、JSON 用户备份/恢复、孤立用户数据必须支持。
- 本地批量/目录/拖拽导入优先；浏览器权限不足需明确降级和重新连接提示。
- 原始包 300 条、295 个独立 hash、3 重复组、297 缩略图，3 SVG 无缩略图。不要把缩略图 SHA 当原图 SHA。
- 移动优先，单手可操作，懒加载和受限 DOM；不做后台管理风格。
- 每个独立阶段测试、更新 PROGRESS.md 并 commit；先修错误再继续。v0.1 完成后停止扩展。
- Forge 仅预留文件来源接口，后台监听留给后续桌面版。

## 当前接手点（2026-09-28）

v0.1 功能与本地验收已完成；先读 PROGRESS.md 的已知限制。当前技术栈为无运行时依赖的原生 ES modules + IndexedDB，Node.js 仅用于本地静态服务和开发测试。运行 `npm start`，开发检查 `npm test`、`npm run test:browser`。

用户已将 v0.1 同步到 main，基线 `2081d75`。当前按新要求在 `codex/daily-mvp` 改进浏览、详情、搜索、收藏和标签的日常体验。保持 manifest/IndexedDB/JSON 兼容，不新增后端、数据库服务、账户、AI 或云同步。完成这五项后停止扩展；以 PROGRESS.md 记录为准。
