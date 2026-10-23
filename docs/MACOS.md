# macOS 本地预览版

这是本机开发构建说明，**不是已经签名公证的公开发行版**。当前不要求改变 Gatekeeper 设置，不建议绕过系统安全提示运行来源不明的包。

**最新 Web 交互修复尚未打包**：用户随后要求所有站内确认 / 校验 / 反馈自有化，当前源码已完成并通过核心 68 / 浏览器 10 回归；下面的 `candidate-20261022` 仍是此前 `c4ea9941…` 的冻结构建，不含本次 UI 与打开失败页。为保留文件身份，本轮没有重建或重试任何原生、App / DMG / 固定副本。`check:mac` 若对照当前工作区提示源码不一致，应如实保留，不绕过检查或声称旧包已同步。详见 INTERACTION_AUDIT.md。

**2026-10-22 发布收尾**：最新源码已构建到独立固定目录 `release/candidate-20261022/Locade.app`，没有覆盖旧 `release/Locade.app` / DMG 或已放行的固定安装副本。新候选通过编译、签名完整性和包内源码一致性检查；原生首次启动 `SIGKILL`、未到就绪、非超时，后续附着测试跳过，没有重复运行原生入口。包内 Node + Chromium 实际截图独立通过；这不是原生整体验收通过，日用仍先使用源码 Web 版。下述旧包 3/3 是历史结果，不能继承到新候选。

候选 DMG 已生成、校验并只读挂载验收；固定副本 `--prepare-only` 为 prepared，实际 `--skip-native` 为 **incomplete（10 检查通过、4 项跳过，退出 1）**。包内核心另完成合成 v1 资料迁移、带图备份恢复及实际进程重启 4/4；没有替换应用、原生点击或跨版本安装升级通过的结论。完整结果见 [发布收尾清单](RELEASE_STATUS.md)。

## 构建

需要 macOS、Apple Command Line Tools（含 swiftc）、Node 22.13+ 和安装好的 npm 依赖。只生成当前机器架构的应用，不是假定通用二进制。

```sh
npm ci
npx playwright install chromium
export LOCADE_RELEASE_DIR=release/candidate-20261022
npm run build:mac     # 此目录本轮已有产物；再次构建会拒绝覆盖，不要删除后重试
npm run check:mac
npm run diagnose:mac  # 只读分发评估；拒绝返回 1，不等同本机进程策略
npm run test:mac      # 本轮已记录 SIGKILL；没有外部条件变化不再重复执行
npm run package:mac   # 已存在的 DMG 同样拒绝覆盖
npm run test:install:mac -- --prepare-only
npm run test:install:mac -- --skip-native  # 保留已知阻拦，只独立验证包内核心
```

构建脚本从 Node 官方站下载固定版本的运行时，校验官方 SHA256，缓存于 `.build-cache/`。不会执行远程安装脚本。将匹配 Playwright 版本的现有 Chromium headless shell、Node、生产服务端和 Web 构建一起封装；不会使用依赖 Homebrew 动态库的本机 Node。

候选输出：`release/candidate-20261022/Locade.app` 与同目录 `Locade-0.3.0-<架构>.dmg`。`LOCADE_RELEASE_DIR` 只接受 `release/` 下一级固定目录（小写字母、数字、连字符），报告 / 镜像 staging / 安装测试目录也按候选名隔离。未设置时仍使用历史默认路径，但构建和镜像命令不再覆盖已有产物。不要为规避本机拦截不断新建候选目录。

`BUILD.json` 含 package 清单、Swift、server、src、dist 的文件哈希和总指纹（不覆盖 tools / tests / docs 或整个仓库）。`check:mac` 比较当前冻结源码指纹与包内 server / dist 的完整文件清单，拒绝文件更改、缺失或增加；这证明封装对应哪份源码，不证明原生 UI 交互已通过。缓存官方 Node 与校验后的官方归档逐字节哈希比较，相同则原样保留，不重新解压覆盖已有运行时。

应用使用本机 ad-hoc 签名供开发测试，没有 Apple Developer ID / 公证，不能据此承诺在其他机器上无警告安装。新候选本机磁盘占用 **362.9 MiB**；旧包此前约 340 MiB，不混作同一产物的大小或轻量优势。

图标从已有品牌 SVG 渲染，源 SVG、品牌 HTML 和预览 PNG 不变。未来打包会保留 Node、Chromium、Playwright 和 React 的第三方许可说明及本项目 MIT LICENSE。2026-10-23 仅将工具中的版本改为跟随 package.json，未执行构建或改变既有包。

## 既有构建验证结果（2026-10-21，用户放行后复测）

本机 arm64 编译、静态完整性和原生运行通过。用户说明本机存在进程拦截策略并已手动放行；复测内置 Chromium 截图成功，不再将此历史阻拦等同于必须配置 Apple 开发签名才能本机运行。

首次复测还暴露一个应用退出问题：后台已就绪并正常关闭，但从 Swift 任务调用 NSApp.terminate 进入嵌套 AppKit 事件循环后，新的 MainActor 等待任务不能完成退出确认。现已改用主 RunLoop Timer 观察自有子进程，仍只终止自身 Process 对象，不升级到任意 PID 强杀。

`npm run test:mac` **3/3 通过**：

- 菜单栏 → 内置 Node 就绪 → 正常退出，清理 instance.lock / runtime.json；不依赖外部 Node，且不继承 NODE_OPTIONS。
- 菜单栏附着已存在的隔离服务，退出后该服务仍可访问、实例 ID 不变；仅由测试自身结束后清理。
- 内置 Node + Chromium 实际生成 PNG，无外部 Playwright 缓存依赖。

测试全部使用临时资料库，没有替用户启用登录项、安装到 Applications 或调整管控策略。未做完整菜单栏逐项视觉交互、登录项、干净机器 / Intel Mac / 所有目标系统验证。应用约 340 MiB（本机磁盘占用），仍非已签名公证的公开发行版。

## 只读排障

`npm run diagnose:mac` 不执行待测二进制、不访问签名私钥、不改安全属性或系统设置。结果写入 `test-results/macos-diagnostics.json`，分别报告磁盘完整性、签名类型、官方 Node 一致性和 Gatekeeper 分发评估。

`spctl --assess` 拒绝时诊断退出 1，表示该分发评估未通过，**不表示用户放行后的本机进程一定不能运行**。实际本机生命周期以 `test:mac` 为准；公开发布仍另需签名 / 公证与安装验证。不要把这两个层次混为一个阻拦原因。

## 日常行为

- 菜单栏入口没有常驻 Dock 窗口；完整卡片库在默认浏览器打开。
- 启动时先尝试验证现有 `runtime.json` 指向的本机 Locade 实例；存在即连接，不重复拉起后台。
- 无可连接实例时用内置 Node 启动后台，绑定 127.0.0.1 的自动分配端口，数据默认在 `~/.locade`。
- 只退出自己通过 Process 对象启动的后台。连接已有 CLI 服务时，退出菜单栏不会停止它，更不会停止发现到的项目。
- 菜单栏弹层打开时同步数据，允许自动发现时每 20 秒扫描；关闭弹层后停止周期扫描。网页也仅在前台且没有编辑 / 弹窗时周期扫描。
- 截图浏览器仅在截图任务内启动，完成或失败后关闭，不复用日常浏览器登录态。
- 「登录时启动」默认不注册，由用户通过开关选择。系统可能要求批准；未签名公证构建的实际登录启动兼容性尚需验证。
- 应用错误在弹层显示，后台错误记录到 `~/.locade/desktop.log`，日志不保存网页正文与完整进程参数。

## 安装、升级与卸载

正式签名版本规划为拖入 Applications。当前只提供本地预览产物，不自动安装到 `/Applications`、注册登录项或配置系统证书。

本地升级：先退出由旧应用自己启动的后台，再替换应用；资料库保留，版本迁移先保留元数据备份。当前没有远程自动更新源，之后选择公开发布渠道与签名方式才接入；不要把普通覆盖文件称为完整自动更新系统。

卸载：先关闭登录启动（若曾开启），退出 Locade，再移除应用。`~/.locade` 默认保留，便于恢复；如需彻底删除数据，由用户自行确认后删除。已导出的备份不受应用删除开关控制，可能含截图和路径，请自行保管。

### 隔离安装验证

`test:install:mac` 只操作测试自有副本和临时资料，不安装到真实 `/Applications`，不使用真实 `~/.locade`，也不注册登录项。

默认测试副本固定为 `.build-cache/install-validation/Applications With Spaces/Locade.app`，不再每次复制到新的随机应用路径。候选模式另用 `.build-cache/install-validation-candidate-20261022/Applications With Spaces/Locade.app`，不会刷新既有默认副本。`--prepare-only` 只准备和校验副本，不执行其中的程序；相同构建复用副本，以免无必要的重新复制影响本机放行规则。固定目录有所有权标记和互斥保护，不静默覆盖未知文件。更换构建需显式 `--refresh`，可能需要用户的进程管控系统重新评估，但工具不会代为修改该系统。

资料库、HOME 和 TMP 仍使用临时隔离目录。默认实际运行固定副本、包内 Web / API、按需 PNG 与重启后资料读取，不替换二进制；结束保留固定测试副本，便于后续运行。安全策略可能还识别文件身份，固定路径本身不是所有策略的通行保证。

只有 `npm run test:install:mac -- --exercise-replacement` 显式执行同版本替换、移除 / 重装和资料保留，测试结束恢复原副本。这些步骤会临时改变相同路径下的文件身份，可能再次触发进程评估，不应在刚放行后无目的反复运行。「同版本替换」不是跨版本升级或完整自动更新验收。

此前默认固定副本的实际执行报告 `test-results/macos-install.json` 为 **failed**：`copied-native-startup` 收到 `SIGKILL`、`reachedReadiness=false`、`timedOut=false`。已停止原生重试；包内 API / Web、真实 PNG 和重启保留资料 / 图片独立通过。未执行替换 / 卸载；只读 DMG 已卸载，临时资料与锁清理完成，固定应用和 native 文件 inode 均不变。新候选的结果独立写入 `macos-install-candidate-20261022.json`，不覆盖这份历史证据；显式跳过原生时整体必须是 incomplete，而不是通过。

先前随机应用路径的原生步骤未通过；用户确认进程管控拦截且路径变化影响放行。该轮同版替换和卸载 / 重装资料结果另存 `test-results/macos-install-isolated.json`。原生被拦截或存在跳过步骤时，不会把包内核心通过当作安装整体通过；`--prepare-only` 成功只报告 `prepared`、不执行程序。固定路径也不能保证策略按路径放行，不建议关闭策略或反复更换文件绕过。

本轮另对原目录应用尝试菜单栏视觉验收，CUA 按绝对应用路径 lookup 返回 `-10005 timeoutReached`，未取得 accessibility state 或截图，**没有任何按钮 / 搜索交互被验证**。自有原生测试进程和 fixtures 已退出，报告 `test-results/native-ui-acceptance.json`。这说明自动化工具未能定位，不等于原生交互有故障。

## 分发前仍需完成

- 在干净的目标 macOS 版本 / 架构机器或 VM 上验证；当前 SDK 可编译 macOS 13+ 目标，不等于已实测所有版本。
- Apple Developer ID、Hardened Runtime / Chromium 子进程的签名兼容性、公证与 stapling。
- 已签名版本的登录项批准、升级和卸载测试。
- 选择发布渠道、版本清单、完整性校验与回滚方式后，再做自动更新。
- 本项目 MIT 已获用户确认；名称与商标仍需独立核查。
