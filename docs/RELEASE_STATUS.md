# v0.3.0-alpha.1 源码发布状态

更新：2026-10-25（Asia/Shanghai）。用户已同意 MIT + 个人 GitHub 仓库 + 先私有 CI 后公开源码 Alpha。**源码预发布不代表整个 PRD 或 macOS 正式发行版已验收。**

## Alpha.2 源码已整合，未发布

完整候选按 #9 → #8 → #7 → #6 逐层合入 `main`，修正迁移恢复副本中断重写的遗漏后才整合；每层当前 head 的 push / PR 三组 CI 和完整树一致性均核验。整合提交 `76b884eea2d0502b8311f883df459e532c18aded` 的 [main CI 40165626385](https://github.com/opszn/locade/actions/runs/40165626385) 三组各核心 **130/130**、浏览器 **17/17**、真实系统发现 **7/7**，无失败 / 跳过。后续文档提交仍须自己的检查。

默认 clone 使用未发布开发源码；已发布版本仍为 Alpha.1，包元数据暂未变。双语快速使用分别提供固定 Alpha.1 和固定整合候选，试用新源码用独立空资料目录，不直接降级 v3。GitHub 已解析默认分支的两个反馈模板，但选择器页面因核验网络超时尚未目视确认。不将 API 识别、源码合入或 CI 当作实际参与者结果。

不创建 Alpha.2 Release / tag / npm 或上传原生文件；Alpha.1 tag 仍保持原提交。A2-07 陌生安装、A2-08 真人一周和原生验收仍未完成。详情见 [Alpha.2 计划](ALPHA2_PLAN.md) 与 [未发布草稿](ALPHA2_RELEASE_NOTES.md)。下文是 Alpha.1 发布的历史记录，不改写其测试数字。

## 本轮完成

- 已核验 GitHub 登录为个人账号 opszn，新建 [opszn/locade](https://github.com/opszn/locade)；先私有通过 CI 后转公开，没有覆盖既有仓库。
- MIT LICENSE、package.json / 锁文件根许可及 `0.3.0-alpha.1` 版本已同步；第三方版本 / integrity / 许可不变，保留 `private: true` 防止 npm 误发布。
- API / library 版本由 package.json 统一；未来原生构建工具的版本和 MIT 文件相应同步，但没有执行构建、运行 / 重签 / 覆盖旧 App / DMG / 固定副本。
- README 使用隔离五项目回归的实际 UI 图，不含用户项目或私人封面；公开图片按精确路径白名单审查，PNG 无文本元数据。首发中文说明见 RELEASE_NOTES.md。
- 本地 Node 24.22.0 / 26.7.0 核心各 **74/74**、完整浏览器 **10/10**、真实系统发现双 **7/7**通过；浏览器复用现有匹配版本，不是干净下载 / 机器验收。

## 发布步骤

- [x] 用户确认 MIT、个人账号和分阶段公开计划；官方 CLI 浏览器授权由用户完成，未读取浏览器 cookies / 密码。
- [x] 创建私有仓库，确认 GitHub Actions 启用。
- [x] 92 文件暂存清单逐字节核对；Gitleaks 源码和完整首次 Git 历史无发现，不提交资料、缓存、日志、备份和旧包。
- [x] 私有仓库提交 `58352add550122a2328ae22957dc9b83e8543056` 的 [CI 39892036075](https://github.com/opszn/locade/actions/runs/39892036075) 三组全部成功，各核心 74、浏览器 10、系统发现 7；runner 实际下载匹配 Chromium / headless shell。
- [x] 上述 CI 通过与源码复核后转公开；GitHub 确认 MIT，私密漏洞报告 enabled=true，SECURITY.md 已提供入口。
- [x] 已发布 [v0.3.0-alpha.1](https://github.com/opszn/locade/releases/tag/v0.3.0-alpha.1) 预发布（prerelease=true、draft=false、无上传附件），tag 精确指向 `ca37a1afc943cce7a906f7c6169e934046b6c0bf`，其独立 [CI 39899446370](https://github.com/opszn/locade/actions/runs/39899446370) 三组成功。仅 GitHub 源码，不上传旧 App / DMG、私有报告或 npm。

**源码 Alpha 公开与预发布已完成。** 私有阶段安全报告查询曾为 404，公开后已启用并查询 enabled=true，没有创建测试漏洞报告或承诺 SLA。发布后的状态文档提交仍须取得其自己的 CI，不能沿用 Release 提交的成功冒充所有提交通过；tag 保留在已经测试的发布提交，不移动或改写历史。

## 延续的安装与安全证据

前一轮官方 npm / npmmirror 分离空缓存安装各 23 个平台包、590 个普通文件 SHA256 相同、锁文件未变，生产构建一致；全部 47 个 tarball 锁为公共 npmjs HTTPS。两个安装选择不改全局 npm 配置、不自动切源、不关闭 TLS。其他平台可选包未实测。

该轮三组（官方 Node 24 / 26、镜像 Node 24）各核心 73 / 浏览器 10 / 系统发现 7；本轮增加版本 / MIT 一致性护栏后核心 74。前轮官方 npm audit 返回 0 条已知漏洞，不是无未知风险保证。浏览器空缓存官方下载在约 20% 因 CDN 缓慢主动中止，不将缓存回归当下载成功；npm 镜像不改变 Chromium 或 Node 封装运行时来源。

## 不发布现有二进制

历史候选 `release/candidate-20261022/` 对应旧源码，不含最新站内交互、当前公共源配置与 Alpha 元数据。其静态封装 / DMG 通过，但原生首次 SIGKILL、未就绪；附着跳过，显式 skip-native 安装 10 检查通过 / 4 跳过、整体 incomplete。包内 PNG、合成 v1 迁移 / 备份恢复 / 核心重启可独立通过，不能冒充原生验收。

旧包历史 3/3、默认固定副本 failed 报告独立保留，不沿用其中的成功代替当前版本。没有重复启动受阻原生，不能因为写入 MIT 或修改版本就说新包完成。正式原生分发仍需视觉 / 登录项、干净机器、跨版本升级卸载、签名公证和渠道验证。

真实一周试用 / 找回效率与竞品实测未完成，Day 0 准备不是留存。名称 / 商标 / npm 包名未核查。完整 I/O 故障与全部竞争时序未穷尽，按 QUALITY.md 与实际反馈继续。

本轮私有证据在 `test-results/github-alpha-20261023/`；前轮在 `test-results/source-release-prep/`。原资料 / PNG / 原生文件最终保留核对单独记录，不公开私人路径、令牌或原始资料库。
