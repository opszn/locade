# Locade

[English](README.md) | 简体中文

> Your localhost, ready to play.

把散落在本机的开发项目，变成一个有真实截图、能再次找回的可视化作品库。

**v0.3.0-alpha.1 · macOS 优先 · 本地存储 · MIT。** 当前建议使用源码 Web 版；不是部署平台，也不是项目进程管理器。菜单栏源码与打包工具已具备，但原生安装验收未完成，暂不提供正式 App / DMG 下载，也没有可用的 `npx locade` 命令。

已发布 Alpha.1 的应用界面与详细文档主要为简体中文。Alpha.2 开发正在加入 Web 中英文切换与首次使用引导，见 [计划与实现状态](docs/ALPHA2_PLAN.md)；这些开发变更不代表已发布新版本或原生验收通过。

[逐步快速使用](docs/QUICK_START.zh-CN.md) · [反馈与隐私](docs/FEEDBACK.md) · [Alpha.1 版本说明](docs/RELEASE_NOTES.md) · [Alpha.2 未发布草稿](docs/ALPHA2_RELEASE_NOTES.md)

Alpha.2 开发还补强了资料与截图提交。本地资料格式升为 v3，旧封面不改名，迁移前保留原元数据副本；不要让旧源码直接写入升级后的目录。导出备份仍包含兼容的 v2 资料，需要回到旧代码时应恢复到独立的空目录，见 [故障恢复与边界](docs/DATA_INTEGRITY.md)。

[GitHub 仓库](https://github.com/opszn/locade) · [源码 Alpha 预发布](https://github.com/opszn/locade/releases/tag/v0.3.0-alpha.1)

![Locade 源码 Web 项目库，使用隔离的受控测试项目](design/screenshots/library.png)

图中是隔离测试网页与临时目录，不是用户真实项目、私人截图或内置演示数据。原始品牌草稿见 [品牌预览](design/brand/preview.png)。

## 能做什么

- 发现本机运行的 HTTP(S) 网页，用真实截图、名称、收藏、搜索和最近访问找回项目；离线后保留卡片与封面。
- 关联进程工作目录、只读 Git 分支；支持手动绑定及显式打开 Finder、VS Code、Cursor。
- 区分项目和地址：换端口尽量保留身份，识别到端口复用时阻止旧卡片误开或继承封面；证据不足时保守处理。
- 比较同名记录的目录、地址和封面，明确选择后忽略，可撤销 / 恢复；不按标题自动合并或清除历史卡片。
- 全局 / 单项目截图许可、删除、容量统计、本地备份与恢复；业务确认、校验和错误反馈由 Locade 自有界面承载。

目标形态是 **macOS 菜单栏入口 + 本地核心 + 浏览器完整项目库**。源码 Web 是目前可验证和试用的入口，不应把菜单栏编译通过当作原生体验验收通过。

## 快速开始

需要 Node.js **22.13+**，推荐已验证的 Node 24；Node 26 也有回归覆盖。当前实测环境为 macOS Apple Silicon，其他平台 / 架构尚未保证。发现依赖系统 `lsof`，不可用时只回退探测常用端口。

在项目目录中选择一种安装来源，**不需要更改全局 npm 配置**：

```sh
git clone https://github.com/opszn/locade.git
cd locade
```

```sh
# 默认：公共 npm 官方源
npm ci

# 或：公共国内镜像（npmmirror，第三方服务）
npm ci --registry=https://registry.npmmirror.com
```

两种方式使用同一份 `package-lock.json`，不更换版本或完整性校验。无企业镜像 / 私有账户依赖，不自动切源；镜像不可用时可显式改回官方源。详见 [安装与来源说明](docs/INSTALLATION.md)。

```sh
npm run build
npm start
```

打开终端显示的 `http://127.0.0.1:4400`。首次进入自动发现；默认每 20 秒在页面可见且没有编辑 / 弹窗时刷新，可在资料工具中关闭。在线状态表示最近探测结果，不是实时保证。

截图前需要额外安装匹配的 Playwright Chromium：

```sh
npm exec --no -- playwright install chromium
```

**npm 镜像不等于浏览器下载镜像**，Chromium 默认仍从 Playwright 配置的下载服务获取。没有浏览器时仍可发现、收藏和打开；截图默认关闭，授权后也必须逐项目触发，不自动批量截图。

默认资料保存在 `~/.locade/`。改用隔离资料库或端口：

```sh
PORT=4401 LOCADE_DATA_DIR="$PWD/.locade" npm start
```

同一资料库只允许一个新版实例；升级前关闭旧服务。`PORT=0` 可分配环回动态端口。

## 隐私与边界

- 管理服务仅绑定 `127.0.0.1`，校验 Host / Origin / Fetch Metadata 和会话变更令牌，不启用 CORS；不应通过代理公开到网络。
- 不自动执行项目脚本，不停止外部服务，不上传截图，不添加遥测、云同步或公网隧道。
- 仅有限读取进程 cwd、启动时间、目录标记和 Git HEAD，不全盘扫描、不执行 Git / hooks。monorepo、worktree 和同目录多服务不会只凭仓库根目录强行合并。
- 发现发送真实 GET，只收录成功 HTML，不跟随重定向、不接受自签名 HTTPS、不复用登录态。遗漏可手动添加最终 HTML 地址。
- 截图限制为环回资源，不复用日常登录态；远程 CDN / API、WebSocket 或需登录的页面可能不完整。这不是恶意网页沙箱。
- 关闭全局截图会请求删除所有当前封面，关闭单项目许可则请求删除该项目封面。Alpha.2 开发版若磁盘清理未完成，会明确警告并提供重试；完成前不要分享资料目录。截图没有默认过期，已导出备份不随应用内删除消失。
- 无身份或瞬时竞争时仍可能有保守重复 / 阻止打开。同名不等于同项目；不要将保留旧卡片理解为无条件自动去重。

## 开发与验证

```sh
npm run check:source      # 公共锁源、公开文件清单及有限敏感内容护栏
npm run format:check
npm test                 # 核心、API、网络、安全与发布护栏
npm run test:ui           # 构建 + 真实 Chromium 浏览器流程
npm run test:discovery    # macOS 真实 lsof / cwd / Git 身份验证
npm run dev              # 构建 + 服务端 watch；前端改动后仍需重新 build
```

测试使用隔离资料库、受控网页和自有进程。浏览器应用测试拒绝原生 alert / confirm / prompt；文件选择、下载和显式打开项目 / 编辑器仍使用正规系统集成。不要同时运行会自动发现的日用实例和根路径 HTML 测试，避免将测试页收录到真实库。

真实 [GitHub CI 39892036075](https://github.com/opszn/locade/actions/runs/39892036075) 已在首次公开前通过：macOS、Node 24 / 26 官方源和 Node 24 国内镜像三组，各核心 **74/74**、浏览器 **10/10**、真实系统发现 **7/7**。远端 runner 也完成匹配 Chromium / headless shell 下载；这是源码 CI，不是原生 App 或全部干净目标机器验收。本地双 Node 回归同样通过，完整限制见 [验收记录](docs/ACCEPTANCE.md)；后续提交状态以 [Actions](https://github.com/opszn/locade/actions) 为准。

## 文档与状态

快速使用和版本说明已有中英文互链，详细工程笔记继续以中文维护。

[PRD](docs/PRD.md) · [安装说明](docs/INSTALLATION.md) · [质量风险](docs/QUALITY.md) · [交互验收](docs/INTERACTION_AUDIT.md) · [macOS 构建](docs/MACOS.md) · [发布清单](docs/RELEASE_STATUS.md) · [一周试用](docs/TRYOUT.md) · [历史性能](docs/PERFORMANCE.md) · [竞品初查](docs/COMPETITIVE_RESEARCH.md) · [项目交接](docs/PROJECT_CONTEXT.md)

目录：`src/` 前端、`server/` 本地核心、`macos/` 原生壳、`tests/` 测试、`tools/` 构建和验收、`design/brand/` 原品牌草稿。

## 许可与发布

本项目采用 [MIT 许可证](LICENSE)，第三方依赖仍遵循各自许可证。`private: true` 仅用于防止误发布到 npm，不影响本仓库的 MIT 授权；当前没有发布 npm 包。名称、npm 包名、域名与商标尚未完成核查。

GitHub 仓库 [opszn/locade](https://github.com/opszn/locade) 已在私有 CI 通过后公开。正式 App 分发、Developer ID / 公证、登录项 / 干净机器验收、完整 PRD 与一周真实使用验证仍未完成；既有本地 App / DMG 不代表最新源码，不作为本次 GitHub 附件。首发说明见 [Alpha 发布说明](docs/RELEASE_NOTES.md)。

贡献前请读 [贡献说明](CONTRIBUTING.md)，安全问题请读 [安全说明](SECURITY.md)。

敏感问题请使用 [GitHub 私密漏洞报告](https://github.com/opszn/locade/security/advisories/new)，不要公开私人项目资料或凭据。
