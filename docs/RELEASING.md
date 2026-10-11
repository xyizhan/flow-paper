# 发布流程

参考同系列 Flow Translate：先验证，再生成安装包、源码包和校验文件，发布到 GitHub Releases。当前平台为 macOS arm64。

1. 更新 package.json / package-lock.json 的版本和 README 下载链接。首个公开版本为 0.2.0-beta.1。
2. 初始化子模块，`npm ci`，运行 `npm run verify` 和 `npm run audit`。
3. 退出已运行的目标打包应用，再运行 `npm run package:mac`。脚本只将构建产物白名单复制到临时目录，收集运行时许可证，生成图标，打包并作本地 ad-hoc 签名。
4. 用 `FLOW_PAPER_EXECUTABLE="$PWD/release/Flow Paper-darwin-arm64/Flow Paper.app/Contents/MacOS/Flow Paper" npm run test:e2e` 验证最终 .app。签名完整性校验不等于 Apple 公证。
5. 运行 `npm run release:mac`，生成 DMG、ZIP 和 SHA256SUMS.txt。脚本拒绝覆盖同名安装包。DMG 包含 Applications 快捷方式、许可证与安装说明。
6. 提交审阅后的源码。在干净工作区运行 `npm run source:archive`，生成包含 LLM for Zotero 与 EmbedPDF 固定提交代码的源码包，将其校验值加入 SHA256SUMS.txt。原生 PDFium 子模块不参与 Flow Paper 构建；对应 npm 运行时、源码地址及许可证保留在上游目录和 lockfile 中。
7. 从源码包的独立解压目录执行 `npm ci && npm run build && npm test`。这验证重建说明，不宣称二进制逐字节可复现。
8. 创建并推送 `v<version>` 标签，将 DMG、app ZIP、source ZIP、SHA256SUMS.txt 一起发布。首版标为 prerelease。下载已发布文件复核校验值、解包、签名和启动。

CI 会在 main 和 PR 上使用 macOS arm64 构建、测试、打包并测试实际 .app。`Publish macOS preview` 工作流可以手动选择已存在的版本标签，执行同样检查并发布预览版。它拒绝发布与 package.json 版本不一致的标签；已经发布的资产不覆盖。

安装包不带真实工作区、密钥、源映射或开发机路径。修改的脚本不能以整个项目目录作为打包输入。上游许可证不可移除，本项目整体许可证为 AGPL-3.0-or-later。

未来使用 Developer ID 和公证时，凭证保存在独立 Keychain / CI Secret，按 [Apple 官方公证流程](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) 签名、提交并 staple；不得将本地签名描述为 Apple 认证。没有自动更新器，用户手动替换应用。
