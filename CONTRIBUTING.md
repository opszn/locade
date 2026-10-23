# 贡献与本地开发

Locade 当前为 v0.3.0-alpha.1 源码 Alpha，采用 [MIT 许可证](LICENSE)，仓库为 [opszn/locade](https://github.com/opszn/locade)。提交贡献前请确认有权按本项目 MIT 许可提供对应内容；保留第三方版权与许可，不提交私人资料或未经授权的代码。

## 开始前

先读 `README.md`、`AGENTS.md`、`docs/PROJECT_CONTEXT.md` 与 `docs/QUALITY.md`。界面工作须查看 `design/brand/preview.png`，沿用暖纸色、炭黑与橙红，不擅自替换品牌。

安装可选公共官方源或公共国内镜像，完整说明见 `docs/INSTALLATION.md`。不要提交企业源、npm 认证或个人安装配置。

```sh
npm ci
npm exec --no -- playwright install chromium
npm run check:source
npm run format:check
npm test
npm run test:ui
npm run test:discovery
```

`test:discovery` 要求 macOS。测试前关闭自己启动且会自动发现的日用 Locade，避免根路径 HTML fixtures 混入真实资料库；不要杀死未知 PID / 外部开发服务。所有验证使用临时资料库和自有进程，测试失败也应清理。

## 变更准则

- 修复先补失败复现与负向回归，尤其防止误开、身份错配、封面误继承、资料丢失和并发覆盖。
- 不按同名、同端口或仓库根目录盲目合并。用户卡片与截图不用于测试、不自动整理真实库。
- 业务确认、输入校验与错误反馈必须使用 Locade 自有 UI，不使用浏览器 alert / confirm / prompt 或原生表单气泡；显式文件选择、下载及系统授权保持正规集成。
- 管理接口保持环回、来源检查和会话令牌；禁止自动执行发现脚本、停止外部进程、放宽截图网络边界。
- 不用编译成功冒称原生 UI 已验收，不用自动测试代替一周真人试用。更新中文交接和相应验证边界。
- 不覆盖已有 App / DMG / 固定安装副本或更改系统安全策略；原生构建和安装实验需看 `docs/MACOS.md`。

## 提交范围与报告

`npm run check:source` 以明确清单检查公开文件，拒绝未知根内容、链接、未审查的二进制和部分敏感信息。新增公开文件须人工检查并同步该清单 / 测试；不要通过扩大白名单绕过秘密检查。规则只能补充人工审查，不是安全保证。

不提交 `.locade/`、`test-results/`、`.build-cache/`、`node_modules/`、`dist/`、`release/`、环境文件、私钥、真实项目截图或完整个人路径。报告 bug 时用受控示例，注明 Node / macOS / 操作步骤和实际结果，不贴会话令牌、资料库、备份或敏感日志。

GitHub CI 仅配置，推送后才有远端执行结果。工作流不发布包、不构建 / 安装原生、不访问签名凭据或注册登录项。
