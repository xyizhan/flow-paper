# Flow Paper

[English](README.en.md) · [下载安装](https://github.com/xyizhan/flow-paper/releases/tag/v0.2.0-beta.1) · [使用与配置](docs/USAGE.md)

<img src="assets/icon.png" width="88" alt="Flow Paper icon">

独立的 macOS 论文阅读器，集成大模型辅助阅读。用 Zotero 整理论文，用 Flow Paper 阅读、批注和提问。

基于 [LLM for Zotero](https://github.com/yilewang/llm-for-zotero) 与 [EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer)，尽量复用成熟的模型客户端、PDF 阅读器和交互代码。与 [Flow Translate](https://github.com/xyizhan/flow-translate) 属于同一系列。

## 下载

**[下载 Apple 芯片 Mac 安装包（DMG）](https://github.com/xyizhan/flow-paper/releases/download/v0.2.0-beta.1/Flow-Paper-0.2.0-beta.1-macos-arm64.dmg)**

首个公开预览版 `0.2.0-beta.1`。支持 Apple Silicon（M 系列）；打包最低版本为 macOS 13，本次本机验证环境为 macOS 26.5。暂未发布 Intel、Windows 或 Linux 安装包。

打开 DMG，将 **Flow Paper.app** 拖入 Applications。也提供 ZIP、包含上游代码的源码包与 SHA-256 校验文件。

当前安装包采用本地 ad-hoc 签名，尚未经过 Apple Developer ID 签名或公证。首次打开可能被系统拦截，请按 [安装说明](docs/INSTALL.md) 在“系统设置 → 隐私与安全性”中选择“仍要打开”。无需关闭 Gatekeeper 或 SIP。

## 使用

- **就地提问**：选中文字后翻译、解释或追问；截图同样可以发给模型。临时框关闭后不进入历史，主动保存才留下记录。
- **对话窗口可停靠、可弹出**：点右上角按钮切换，或拖动六点手柄到阅读器右边缘，看到预览后松手吸附。调整侧栏宽度、移动到第二块屏幕，草稿与正在生成的回答都会保留。
- **多篇论文对话**：勾选论文进行比较，或检索已索引的文献库；回答提供原文页码链接。
- **阅读与记录**：多标签 PDF、搜索、高亮、批注、Markdown 笔记及导出。PDF 渲染和文本提取在本机完成。
- **连接 Zotero**：只读接入本机个人文献库及分类，可导入 LLM for Zotero 已有模型设置。也可直接打开本地 PDF。

![选句后就地临时提问](docs/assets/quick-chat.png)

*截图使用自动生成的测试 PDF 和模拟模型回复，不包含私人文献库。*

第一次使用，先打开 PDF，再在齿轮菜单中配置模型。支持 OpenAI Compatible、Responses、Anthropic、Gemini、Ollama 和上游 Codex 本机登录路径；截图问答需要视觉模型。模型服务需要自行配置，安装包不含 API Key。

## 数据与边界

论文原文件和 Zotero 数据库不被修改。Flow Paper 的索引、批注、笔记与长期对话保存在本机工作区；点击发送时，选定上下文与图片会交给所配置的模型服务。API Key 用 Electron safeStorage 加密保存。没有内置统计上报和自动更新器。[隐私说明](docs/PRIVACY.md)

多篇分析使用文本提取与上游 BM25 检索，超过预算时会标为部分检索，并不表示逐篇读完了整个库。目前没有 Paperlib 接入、群组库、Zotero 批注双向同步、OCR 或自主综述 Agent。扫描件可以阅读和截图提问。模型回答需自行核对。

## 从源码运行

需要 Node.js 24 和 npm；macOS 打包还需要 Xcode Command Line Tools。上游代码是固定提交的 Git 子模块。

```sh
git clone https://github.com/xyizhan/flow-paper.git
cd flow-paper
git submodule update --init
npm ci
npm start
```

若下载 Release 中的 `Flow-Paper-…-source.zip`，上游源码已包含，解压后直接 `npm ci && npm start`。GitHub 自动生成的 Source code ZIP 不含子模块，请使用我们额外上传的源码包。

```sh
npm run verify       # 构建、单元测试、真实 Electron/PDFium + 本地模拟模型回归
npm run package:mac  # Apple Silicon .app
npm run release:mac  # DMG / ZIP / SHA256SUMS.txt
```

普通测试不调用真实模型，不消耗付费额度。涉及真实 Zotero 的测试需显式提供论文参数，见 [验证记录](docs/VALIDATION.md)。

[发布流程](docs/RELEASING.md) · [参与开发](CONTRIBUTING.md) · [安全问题](SECURITY.md)

## 开源与复用

整体采用 **AGPL-3.0-or-later**，延续 LLM for Zotero 的许可证。项目不隶属于 Zotero、LLM for Zotero 或 EmbedPDF。

- `vendor/llm-for-zotero`：直接复用模型传输、流式输出、多模态请求、提示词、上下文预算、Markdown/公式渲染、检索和界面尺寸工具。
- `vendor/embedpdf`：保留参考源码；PDF 界面使用锁定版本的 `@embedpdf/snippet` 2.15.1，渲染、选区、截图、批注和导出均由其提供。
- `src/`：Electron 宿主、本地存储、Zotero 只读连接、临时会话和窗口停靠适配。`upstream.json` 记录上游提交。

完整来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；安装包也附带运行时依赖的许可证。感谢上游作者和贡献者。
