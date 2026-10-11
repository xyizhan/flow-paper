Flow Paper 的首个公开预览版，面向 Apple 芯片 Mac。

- 独立 PDF 阅读、多标签、高亮、批注与导出。
- 选句翻译 / 解释 / 临时追问，以及截图问答；临时内容默认不存入历史。
- 长期对话支持右侧停靠、独立窗口和拖动吸附；草稿、附件与流式回答随窗口保留。
- Zotero 个人文献库只读连接、多篇论文检索与页码引用、Markdown 笔记。
- 直接复用 LLM for Zotero 与 EmbedPDF，整体采用 AGPL-3.0-or-later。

**下载 DMG 后把 Flow Paper.app 拖入 Applications。** ZIP 为备用安装包；source.zip 包含两个固定提交的上游源码目录，GitHub 自动生成的 Source code 不含子模块。SHA256SUMS.txt 可校验所有三个包。

要求 Apple Silicon，打包最低 macOS 13；本次本机验证环境为 macOS 26.5。当前为 ad-hoc 签名，未做 Developer ID 签名和 Apple 公证；首次被拦截可使用系统设置 → 隐私与安全性 → 仍要打开。模型服务需自行配置，安装包不含 API Key 或私人论文。

打包前后均运行真实 Electron/PDFium 交互回归，模型服务使用本地模拟响应，覆盖临时问答、截图、多篇上下文、停靠/弹出、批注与保存恢复。真实 Zotero 与模型链路另在开发阶段验证。最低系统版本、长时间负载、Intel/Windows/Linux 尚未完成验收。详情见仓库 docs/VALIDATION.md。
