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
- `src/`：v0.1 程序（持续建设中）。
- `scripts/`：本地启动和 Starter 审计。
- 原始 ZIP：已有历史成果，保持不变。

当前阶段：已完成接管审计，功能开发进行中。程序永远不自动删除原图和重复图。用户数据将以 SHA-256 关联，独立于基础元数据保存。
