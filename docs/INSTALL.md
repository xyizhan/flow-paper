# 安装、更新与卸载

## 安装

1. 从 https://github.com/xyizhan/flow-paper/releases 下载当前版本的 `macos-arm64.dmg`。适用于 M 系列芯片，打包最低要求 macOS 13；首版本机测试环境为 macOS 26.5。
2. 打开 DMG，将 Flow Paper.app 拖入 Applications，然后推出磁盘映像。
3. 在“应用程序”中打开 Flow Paper。若系统因开发者无法验证而阻止运行，在尝试打开后前往“系统设置 → 隐私与安全性 → 仍要打开”，确认系统提示。首版只有 ad-hoc 签名，没有 Developer ID 签名和 Apple 公证。
4. 打开 PDF，点齿轮配置自己的模型。也可以连接本机 Zotero。

ZIP 是备用安装包，解压后同样将 .app 移入 Applications。无需关闭系统安全机制或运行移除隔离属性的命令。

校验下载文件：把 SHA256SUMS.txt 和同一版本全部下载文件放在一起，在该目录运行 `shasum -a 256 -c SHA256SUMS.txt`。只下载部分文件时，其余项目会提示缺失。

## 更新

退出 Flow Paper 后用新 .app 替换旧版。暂不自动更新，通过 GitHub Releases 下载。

新用户数据保存在 `~/Library/Application Support/Flow Paper/workspace.json`。早期原型已有 `Su Paper/workspace.json` 且没有新工作区时，会继续使用旧目录和钥匙串标识，以保留现有加密 Key、笔记、批注和对话。请勿同时运行早期原型和新版。菜单与应用名称仍显示 Flow Paper。

更新前可在退出应用后备份工作区目录；它含笔记、对话和加密凭证，不要公开上传。API Key 的加密与本机钥匙串关联，迁移到另一台电脑后可能需要重新填写 Key。

## 卸载

退出后将 Flow Paper.app 移到废纸篓。工作区仍保留，重新安装可继续使用。只有确实要删除所有笔记、批注、对话和设置时，才手动删除对应 Application Support 目录。此操作不会删除原 PDF 或 Zotero 文献库。
