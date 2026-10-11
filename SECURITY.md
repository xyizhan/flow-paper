# 安全问题

请不要在公开 Issue 上传真实 API Key、Codex 登录文件、Zotero 配置、工作区或私人 PDF。普通错误可提供系统版本、Flow Paper 版本和使用生成文档的复现步骤。

涉及凭证泄露、任意文件访问或代码执行的问题，请优先使用仓库 Security → Report a vulnerability 私下提交。若该入口不可用，可先提交不含漏洞细节的联系请求。泄露的 API Key 应先在服务商侧撤销。

应用使用隔离上下文和 sandbox 预加载，渲染端通过限定 IPC 访问主进程；Markdown 输出经过上游 DOMPurify。依赖安全更新仍需要维护和验证。首版使用 ad-hoc 签名，没有 Apple 公证。
