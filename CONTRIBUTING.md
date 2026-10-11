# 参与开发

使用 Node.js 24，按 README 初始化两个上游子模块并运行 `npm ci`。尽量复用上游能力，通过 `src/` 中的适配层连接宿主。不要把 vendor 中的上游改动直接混入集成代码；更新提交时同步修改 upstream.json 并运行回归。

提交前运行 `npm run verify` 与 `npm run audit`。改动窗口、PDF 交互或保存流程时，对打包后的 .app 再运行一次端到端测试。Issue/PR 请写清触发场景、预期行为、实际结果和验证方式。

测试使用生成的 PDF 和模拟模型，不提交真实文献库、API Key、auth.json、workspace.json 或私人论文。截图也使用测试夹具。贡献遵循项目的 AGPL-3.0-or-later 许可证。
