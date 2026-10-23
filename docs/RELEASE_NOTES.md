# v0.3.0-alpha.1 · 源码 Alpha

日期：2026-10-23（Asia/Shanghai）。这是 Locade 的首个源码预发布，不是正式 macOS App，不表示整个 PRD 已验收。采用 MIT 许可证，不发布 npm 包，不附加现有 App / DMG 或私有运行记录。

## 这次提供什么

- 本地 HTTP(S) 项目发现、真实截图卡片、离线保留、搜索 / 收藏 / 最近访问。
- 进程 / 目录 / 只读 Git 身份线索，手动绑定与显式 Finder / VS Code / Cursor 入口。
- 换端口 / 端口复用保护、同名比较、用户明确选择后的忽略 / 撤销，不按标题自动合并。
- 全局 / 项目截图许可、删除与用量、本地备份恢复，站内自有确认 / 校验 / 错误页。
- 公共 npm 官方源默认安装，公共国内镜像可选，同一份锁文件保留完整性校验。

## 如何试用

当前推荐 macOS Apple Silicon，Node.js 22.13+（推荐 Node 24）：

```sh
git clone https://github.com/opszn/locade.git
cd locade
npm ci
# 国内用户也可选择：npm ci --registry=https://registry.npmmirror.com
npm run build
npm start
```

截图需额外 `npm exec --no -- playwright install chromium`，npm 镜像不改变浏览器下载来源。打开终端显示的环回地址，截图默认关闭，授权后逐项目触发；没有浏览器时仍可发现、收藏和打开。完整说明见 [安装文档](INSTALLATION.md)。

## 已验证与未验证

首次公开前，私有仓库的 [GitHub CI 39892036075](https://github.com/opszn/locade/actions/runs/39892036075) 三组全部成功：macOS / Node 24、26 官方源与 Node 24 国内镜像，各核心 74/74、浏览器 10/10、真实系统发现 7/7。runner 实际下载匹配 Chromium 后执行浏览器测试。本地双 Node 回归及格式 / 公共源码护栏也通过；本地浏览器复用匹配缓存，不能混称从零下载成功。CI 仍不是原生或所有目标干净机器安装验收，后续提交状态看各自 Actions。

已知限制：只收录成功 HTML；跳转、登录、自签名 HTTPS 或远程资源依赖可能遗漏 / 截图不完整。身份不足时仍可能保守保留重复卡片或阻止旧地址，不是恶意网页沙箱、无缺陷保证或真人效率证明。

Swift 菜单栏源码与打包工具可供审阅，但历史候选不含最新源码，原生安装整体未通过；不提供其下载，也不要求关闭系统安全策略。原生视觉 / 登录项、干净机器 / Intel Mac、跨版本升级、签名公证，以及一周真实试用仍待完成。详见 [质量风险](QUALITY.md) 与 [发布状态](RELEASE_STATUS.md)。

## 隐私与反馈

项目资料 / 截图留本机，不上传、不遥测；不自动执行项目脚本、不停止外部服务。默认 `~/.locade` 和导出备份可能含私人路径 / 图片，勿提交到 issue。

README 图片来自受控测试项目，不是用户真实作品。安全问题先读 [安全说明](../SECURITY.md)，不要公开漏洞秘密或真实资料。
