---
name: "Bug report / 问题反馈"
about: "Report a reproducible problem using anonymous examples / 使用匿名示例报告可复现问题"
title: "[Bug] "
labels: ""
assignees: ""
---

<!--
Reply in English or Chinese; delete the instructions, not the privacy reminder.
可使用中文或英文填写；删除填写说明即可，请保留隐私提醒。

This is a PUBLIC issue. Do not attach personal paths, project screenshots, library files,
raw logs, session tokens, credentials, or backups. These reminders do not automatically redact your report.
这是公开 issue。不要提交个人路径、资料库、项目截图、原始日志、令牌或备份。提醒不会自动脱敏。

Security concern or private data exposure? Use the private report, not this template:
安全漏洞或资料泄露请走私密报告，不要在此公开细节：
https://github.com/opszn/locade/security/advisories/new
-->

This is public. Do not attach personal paths, project screenshots, library files, raw logs, session tokens, credentials, or backups. These reminders do not automatically redact your report.

这是公开反馈。不要提交个人路径、资料库、项目截图、原始日志、令牌或备份，提醒不会自动脱敏。敏感安全问题请用 [私密报告 / private report](https://github.com/opszn/locade/security/advisories/new)。

## Privacy / 隐私

- [ ] I removed private data and can share this report publicly. / 我已删除私人资料，确认可以公开。
- [ ] This is not a sensitive security report. / 这不是需要私密报告的安全问题。

## Version / 版本

- Locade tag or branch + commit / Locade tag 或分支 + 提交：
- Package version alone may be unchanged during Alpha.2 development. Add the output of `git rev-parse --short HEAD` if using Git. / Alpha.2 开发中包版本可能未变；使用 Git 时请附 `git rev-parse --short HEAD` 的短提交号。

## Environment / 环境

- macOS version + Apple Silicon or Intel / macOS 版本与芯片（其他系统请注明）：
- Node version (`node --version`) / Node 版本：
- npm version (`npm --version`) / npm 版本：
- Browser name + version, UI language / 浏览器名称版本、界面语言：
- Install source: npm / npmmirror / other public source / not known. No registry credentials. / 安装来源：npm / npmmirror / 其他公共源 / 不清楚；不要贴认证配置。
- Playwright Chromium: installed / missing / not tried. File readiness is not proof of launch. / 截图浏览器：已装 / 缺失 / 未尝试；文件就绪不代表启动成功。

## Steps / 复现步骤

Use a tiny synthetic page, project A/B and placeholder directories. Do not restart a private project or delete data just to complete this report. / 用简单受控页面、项目 A/B 与占位目录描述；不必为填表重启私人项目或删除资料。

1.
2.
3.

For duplicate or wrong-project behavior, describe port changes, observed owner changes and the number of open windows without private names. / 同名或误开问题请匿名描述换端口、进程变化和窗口数量。

## Expected / 预期

What should happen? / 应当发生什么？

## Actual / 实际

What happened and how often? Quote only a short sanitized error or filesystem code such as EACCES. Do not include a session token. / 实际发生什么、频率如何？仅贴短小且已脱敏的错误或 EACCES 等错误码，不要包含会话令牌。

If data may be lost or a wrong project opened, stop destructive actions and say so; do not clear the library to hide the symptom. / 若疑似丢资料或误开，请停止破坏性动作并说明，不要清空库来消除症状。

## Workaround / 已尝试

Optional: what helped, failed, or was not tested? Do not disable security controls. / 可选：哪些办法有效、无效或未测试？不要关闭安全策略。
