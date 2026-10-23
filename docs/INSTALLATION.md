# 安装与公共依赖来源

更新：2026-10-22。目标是让没有企业网络 / 账户的使用者可以安装同一份锁定源码依赖，不在应用界面中切换安装器，也不修改用户全局 npm 配置。

## 环境

- Node.js 22.13+；推荐已验证的 Node 24，另有 Node 26 回归。使用 `node --version` / `npm --version` 核对实际终端环境。
- 当前完整本地验证为 macOS Apple Silicon。系统发现使用 `lsof`；Windows / Linux、Intel Mac 和全部目标 macOS 版本未验收。
- 首次安装 npm 包、浏览器以及首次 macOS 封装下载运行时均需要网络。安装后本地核心无需云账户；被打开的项目本身可能依赖网络。

## 方式一：公共官方源（默认）

项目 `.npmrc` 默认指定公共 npm：

```sh
npm ci
npm run build
npm start
```

也可显式指定：

```sh
npm ci --registry=https://registry.npmjs.org
```

## 方式二：公共国内镜像（可选）

```sh
npm ci --registry=https://registry.npmmirror.com
npm run build
npm start
```

npmmirror 是第三方公共镜像，不是 Locade 官方服务。可用性、同步延迟、访问策略由运营方决定；它不是国内网络的可达性保证。本项目不需要或提供私有凭据，不对所有使用者自动切源或降级 TLS。npm 本身仍会读取你自己的用户配置，请勿公开其中的认证信息。

两种选择都只控制这次 npm 安装。不要为使用 Locade 执行全局 `npm config set registry`，也不要将企业 / 私有认证配置提交到仓库。

## 一份锁文件，两条下载路径

- `package-lock.json` 中所有 tarball 使用 `https://registry.npmjs.org/`，包含版本和 SHA512 integrity，不记录企业镜像地址。
- 项目 `replace-registry-host=npmjs` 让 npm 将标准 npmjs 下载主机替换为显式选择的 registry；无需维护两份锁文件或执行 `npm install` 重新解依赖。
- `strict-ssl=true` 保留 HTTPS 证书校验。镜像缺少版本或完整性不匹配时应失败，不删除 integrity、不关闭 TLS、不静默使用其他来源。
- 镜像失败可手动重新执行官方源的 `npm ci`；反之亦然。`npm ci` 会重建项目自身 node_modules，切源前关闭使用该目录的服务，并保留锁文件。
- 本次在分开的干净 npm 缓存 / 配置下各执行一次完整安装：两边均安装 23 个当前平台适用包，590 个普通安装文件逐字节哈希相同，锁文件未改；其余平台可选包并未在本机安装。

运行 `npm run check:source` 可检查锁源、TLS 配置和公开源码范围。该有限规则不是全面供应链审计；不能因为使用公共源就认为依赖绝对安全。

## Chromium 是独立下载

npm registry 只提供 npm 包，**不会切换 Playwright 浏览器的下载来源**：

```sh
npm exec --no -- playwright install chromium
```

使用本地锁定版本的 Playwright 安装匹配浏览器，不允许临时从 npm 拉取其他 CLI。默认遵循该版本 Playwright 的下载配置；本次另尝试空浏览器目录的官方默认下载，但因 CDN 传输缓慢在约 20% 主动中止，未完成干净下载。三组浏览器回归复用本机已有的匹配 Chromium，不将缓存测试误报为新下载或干净机器安装通过。

如果网络需要代理或浏览器镜像，按 [Playwright 官方浏览器文档](https://playwright.dev/docs/browsers) 配置可信的下载主机 / 企业网络；`PLAYWRIGHT_DOWNLOAD_HOST` 与 `PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST` 独立于 npm registry。Locade 不预设未经验证的第三方 Chromium 镜像、不关闭证书校验，也不附带凭据。浏览器下载不可用时可先使用发现 / 收藏 / 打开，按需截图需浏览器可用。

## macOS 封装另有运行时来源

`npm run build:mac` 从 Node.js 官方站下载固定 Node 运行时并核对 SHA256，再使用匹配的本地 Chromium。npm 镜像不改变 Node 下载来源。自包含 App 规划是不要求最终用户配置 Node，但目前原生验收和正式分发尚未完成，见 [macOS 构建](MACOS.md)。

## 排障与卸载

- `EINTEGRITY`：保留错误和锁文件，检查镜像同步 / 网络，显式改回官方源；不要通过删锁或禁用校验掩盖问题。
- `ENOTFOUND` / 超时：检查所选公共源和网络 / 代理。不要在公开 issue 贴含认证信息的完整 npm 配置或日志。
- `npm ci` 报锁文件与 package.json 不符：停止并核对源码，不用 `npm install` 自动更换版本掩盖发布问题。
- 安装脚本安全提示：不同 npm 版本的策略可能不同；本次干净安装出现可选 `fsevents` 安装脚本提示，未为此添加通用 allowScripts 或执行远程 shell。
- 默认管理地址 `http://127.0.0.1:4400`；端口占用可设置 `PORT=4401` 或 `PORT=0`，不要结束不属于 Locade 的服务。
- 停止源码服务后可移除项目目录；`~/.locade` 与已导出备份不会自动删除。彻底删除资料须自己确认，包含本地截图和路径。
