# 验证范围

首个公开版本：0.2.0-beta.1。开发机为 Apple Silicon / macOS 26.5，最低 macOS 13 来自 Electron 运行时要求，并未声称已在每个系统版本测试。

## 可重复的离线回归

`npm run verify` 使用自动生成的 PDF、本地模拟 Zotero API、本地模拟 SSE 模型服务、真实 Electron/PDFium 和直接复用的上游客户端。

覆盖：PDF 文字选择、高亮、撤销/重做、批注前后缩放；临时翻译、拖动、防溢出、取消后隔离、不写历史；截图多模态请求；多篇上下文与来源跳转；长期对话停靠/弹出/吸附、草稿/附件/流保留；宽度调整；笔记、批注、对话关闭与重启恢复；快速关闭 PDF 标签的迟到 UI 状态读取。

构建安装包后，用 `FLOW_PAPER_EXECUTABLE="$PWD/release/Flow Paper-darwin-arm64/Flow Paper.app/Contents/MacOS/Flow Paper" npm run test:e2e` 对实际 .app 重复回归。测试使用独立工作区，不读取用户模型设置。23119 被真实 Zotero 占用时，测试会跳过模拟 Zotero 项，不读取真实库。

## 真实数据的开发验证

发布前曾在独立测试工作区验证真实 Zotero 接入、多份 18–34 页论文、选区翻译、跨论文回答、截图问答、原文页码跳转、批注保存恢复与短时连续滚动。模型和个人文献库的明细、原始请求和截图保留在本机，未纳入发布包。

链路通过不保证模型回答正确，实际视觉回答曾存在图意误判。短时滚动测试也不能证明所有 PDF、长期会话和不同硬件都没有卡顿。扫描件 OCR、大型文献库持续索引和跨机器兼容性还需要更多验证。

## 可选真实模型测试

`test/real-library.mjs` 是指定论文的交互夹具，需手动提供两个标题前缀，且第一篇的版式需匹配脚本所用摘要及图 1 坐标：

```sh
FLOW_PAPER_REAL_TITLES='["First paper title","Second paper title"]' node test/real-library.mjs
```

它会连接真实 Zotero、导入首选模型、发送论文和截图，可能产生费用。它不在 CI 或普通测试中运行。输出只存入被 Git 忽略的 test-output。

`node test/reading-performance.mjs` 读取上述独立测试工作区中已索引的前四篇论文，检查滚动与跳页，不调用模型。可用 `FLOW_PAPER_PERF_IDS='["id-1","id-2"]'` 指定工作区中的条目。
