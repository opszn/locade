# Feedback / 问题反馈

Updated / 更新：2026-10-25。English and Chinese reports are welcome / 欢迎中文或英文。

## English

### Choose A Safe Channel

- **Ordinary bug or usability problem:** use the repository's [new issue page](https://github.com/opszn/locade/issues/new/choose). Both Markdown templates have merged into the **default branch**, and GitHub's `issueTemplates` API recognizes them. Direct browser / HTTP access to the chooser timed out on the verification network, so this is server-side recognition, not visual acceptance. If the chooser cannot load for you, use the anonymous fields in this guide. The default-branch activation rule follows [GitHub's template documentation](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository).
- **Vulnerability, exposed secrets, or private data:** use [private vulnerability reporting](https://github.com/opszn/locade/security/advisories/new). Do not first post exploit details or real data in a public issue. Read the [security policy (Chinese)](../SECURITY.md); no response SLA or private support channel for ordinary bugs is promised.
- **First-run feedback:** record only what you actually tried. Needed help, failure, stopping, and not trying a step are all useful results. Posting feedback does not enroll you in a study, authorize contacts, start a one-week timer, or enable telemetry.

Templates are reminders, **not an automatic privacy filter or redaction service**. Markdown checklists do not enforce completeness or prevent accidental disclosure. The chooser discourages blank community reports; maintainers may still have a blank option. No test issue or security advisory is created just to validate the templates.

### What To Include

1. Locade tag, or branch + short commit (`git rev-parse --short HEAD`); development may keep the Alpha.1 package version even when behavior changes.
2. macOS version and Apple Silicon / Intel, or the other OS if applicable; Node (`node --version`), npm (`npm --version`), browser version and UI language. Report npm / npmmirror / another public source by name only, never credentials or complete configuration.
3. A small sequence using a synthetic HTML page, project A/B, and placeholder directories. Explain port changes or two open windows if relevant. Do not run a private project, stop an external service or damage a disk to reproduce a fault.
4. Expected versus actual behavior, frequency, and a short manually sanitized error / filesystem code such as EACCES. Say whether Chromium is installed, missing, blocked, or not tried; an executable-file check is not launch verification.
5. Optional workarounds and where you needed assistance. An untried step is **not** a successful step. There is no requirement to report productivity or benchmark numbers.

### What Not To Share

Do not attach `library.json`, `runtime.json`, the `~/.locade/` directory, `before-restore.json`, migration copies, exported backups, original logs, process listings, shell environment, npm authentication config, personal absolute paths, project names / URLs with secrets, real cover images, session tokens or credentials. Even metadata-only backups contain private names and paths.

There is no need to send any screenshot. If a controlled example truly needs one, create it from a fresh synthetic page and inspect every visible element yourself; crop or redact locally first. Do not upload a private image and expect maintainers or GitHub to scrub it. Avoid full screenshots of the diagnostics panel, which includes your data-directory path.

### Suspected Data Loss Or Wrong Project

Stop destructive actions; do not delete, ignore, merge, recapture, restore over or downgrade your real library to make the symptom disappear. Preserve it locally and describe the anonymous sequence first. A cleanup warning means images may remain on disk, so do not share that directory. See the [data-integrity limits (Chinese)](DATA_INTEGRITY.md) and [English quick start](QUICK_START.md).

If a native program is blocked, do not disable system security or repeatedly move / re-sign / launch it to evade policy. Report that boundary without uploading a full security log. There is currently no accepted official App / DMG download.

If you already posted a credential, revoke or rotate it at its original service promptly, then remove the public material and seek private help. Editing the current issue alone cannot undo disclosure. Do not paste the credential again to demonstrate the problem.

## 简体中文

### 选择合适入口

- **普通 bug 或使用困惑**：进入 [新建 issue](https://github.com/opszn/locade/issues/new/choose)。两个 Markdown 模板已合入**默认分支**，GitHub 的 `issueTemplates` API 已识别。当前核验网络的浏览器 / HTTP 访问均超时，因此只确认服务端识别，不冒称选择器页面目视验收；若你也打不开，可参照本文匿名字段。[GitHub 模板说明](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)说明了默认分支生效的规则。
- **漏洞、凭据或私人资料暴露**：走 [私密漏洞报告](https://github.com/opszn/locade/security/advisories/new)，不要先在公开 issue 披露利用细节或真实资料。另见 [安全说明](../SECURITY.md)；不承诺响应 SLA，也不虚构普通问题的私密客服入口。
- **首次使用反馈**：仅记录实际尝试，失败、求助、中止、未尝试都有效。反馈不等于报名试用、不授权主动联系、不启动一周计时或遥测。

模板**不会自动检测秘密或脱敏**。Markdown 勾选项不强制完整性，也无法阻止误公开。选择器不向普通贡献者提供空白模板，但维护者仍可能看到空白入口。本轮不靠创建测试 issue 或安全报告假装验收。

### 建议提供

1. Locade tag 或分支 + 短提交号（`git rev-parse --short HEAD`）。开发期间包版本可能仍是 Alpha.1，单看版本号不足以定位行为。
2. macOS 版本与 Apple Silicon / Intel，其他系统如实注明；Node（`node --version`）、npm（`npm --version`）、浏览器版本、界面语言。安装来源写 npm / npmmirror / 其他公共源名称，不贴认证与完整配置。
3. 用受控 HTML 页面、匿名项目 A/B 与占位目录描述步骤。涉及换端口、双窗口时说明先后次序；不必启动私人项目、停止外部服务或损坏磁盘来复现。
4. 预期 / 实际、频率、短小且人工脱敏的错误或 EACCES 等错误码。Chromium 已装 / 缺失 / 被阻止 / 未尝试如实注明，文件可执行不等于验证启动。
5. 可选的临时解决办法与求助点。未尝试不计通过，不要求填效率或性能成绩。

### 不要公开

不上传 `library.json`、`runtime.json`、`~/.locade/`、`before-restore.json`、迁移副本、导出备份、原始日志、进程清单、环境变量、npm 认证配置、个人绝对路径、带秘密的项目名 / URL、真实封面、会话令牌或凭据。仅元数据备份也包含私人名称和路径。

无需提供任何截图。若确实需要受控例图，请用全新合成页面生成，在本机逐项检查、裁剪或遮盖后再自行决定；不要先上传真实图片再期待维护者或 GitHub 处理秘密。诊断面板含资料目录，不要整屏贴出。

### 疑似丢资料或误开

暂停破坏性动作，不要通过删除、忽略、合并、重截图、覆盖恢复或降级真实库消除症状。资料自己本地保留，先反馈匿名步骤。清理警告表示图片可能仍留磁盘，不要分享该目录。另见 [资料故障边界](DATA_INTEGRITY.md) 与 [快速使用](QUICK_START.zh-CN.md)。

原生程序受阻时不要关闭系统安全策略，不反复换路径、重签或启动来规避。描述阻塞即可，不贴完整安全日志；目前没有已验收的正式 App / DMG 下载。

若已公开凭据，立即在所属服务吊销 / 轮换，再移除公开材料并寻求私密帮助；仅编辑当前 issue 无法撤销泄露，不要为了证明问题再贴一次凭据。
