# Alpha.2 候选打包 / Candidate Packaging

更新：2026-10-26。用户要求明确版本、生成新本地包并准备对应 GitHub 入口。本轮目标为 **v0.3.0-alpha.2**，不是稳定发行、整个 PRD 完成或真人验证通过。

## 当前状态

- 版本：源码、API、Web 显示和候选包使用 `0.3.0-alpha.2`。macOS 菜单栏分别显示 App 和实际连接后台的版本，避免把旧后台误认为新版本。
- 固定候选输出目录：`release/alpha2-20261026/`；不覆盖旧 `release/Locade.app`、DMG 或已放行的固定测试副本。
- 包含当前 v3 资料支持、截图提交保护、双语 Web，以及启动失败提示保留。原生菜单栏文案仍主要为中文，不冒称完整原生国际化。
- 构建与静态包检查已通过；新候选原生生命周期测试仍收到 `SIGKILL`，内置截图运行通过。此前包的通过不继承，源码 CI 也不代替原生体验；因此当前不提供可下载 GitHub 附件。
- 使用本机 ad-hoc 签名，未签名公证为可信发行物；不要求关闭安全策略、移除 quarantine 或反复更换路径规避拦截。被拦截时停止重复尝试并如实记录。
- GitHub 可以记录候选说明，但在原生生命周期和签名 / 公证未通过前，不上传 App / DMG 或把它标为可用下载。不发布 npm，不移动 Alpha.1 tag。

## 实际候选结果

- App / DMG：已生成，版本为 `0.3.0-alpha.2`，输出目录固定，不覆盖历史产物。
- `check:mac`：通过包内版本、源码清单、签名完整性、官方 Node、服务端 / Web / 浏览器 / 品牌资源检查。
- `diagnose:mac`：包内资源和 Node 一致；Gatekeeper 分发评估拒绝，符合 ad-hoc 未公证预期。
- `test:mac`：原生生命周期 `SIGKILL`，内置截图浏览器通过；不再重复启动，不称作原生验收通过。

## 试用与资料

1. 默认推荐源码 Web。新 App 测试首先使用隔离空资料和自有服务，不直接操作真实作品。
2. 旧 App 仅支持资料 v1 / v2，不能直接使用已升级的 v3 库。不要删除资料、实例锁或用旧 JSON 覆盖来解决启动失败。
3. 使用新 App 前通过旧 App 自己的「退出」关闭旧入口。若连接现有源码后台，菜单栏应显示其真实版本；退出附着入口不应停止原后台。
4. 管理资料仍只在本机，截图默认关闭、逐项目显式触发。迁移副本是元数据，不是图片备份。回旧代码时，先显式导出兼容备份，恢复到独立空目录。
5. 没有修改登录项、系统策略或签名凭据。干净机器、正式签名公证、跨版本安装升级和真人一周仍未验收。

## English

This is **v0.3.0-alpha.2 candidate preparation**, not a stable release. Version labels identify the App and its connected service separately. The fixed local output is `release/alpha2-20261026/`; existing bundles and disk images are preserved.

The candidate includes library v3 support and current web fixes. Old bundles cannot read v3: never delete data, remove locks, or replace live JSON to force a downgrade. Use isolated data for testing; explicit compatible exports can be restored into a separate empty directory when returning to older source.

Local builds are ad-hoc signed, not Developer ID signed / notarized. Never disable system security or repeatedly move / re-sign blocked applications. Build, source CI, native lifecycle, installation, clean-machine acceptance and human usage are separate evidence. A GitHub draft is not a published release; unverified native files must not be offered as an accepted download. No npm publication or change to the Alpha.1 tag is intended.
