export const diagnosticMessages = {
  '不允许的 Host': 'Host is not allowed',
  不允许跨站访问: 'Cross-site access is not allowed',
  请求内容过大: 'Request body is too large',
  不支持的请求: 'Request method is not supported',
  '项目不存在，请返回项目库': 'Project not found. Return to the library.',
  接口不存在: 'API endpoint not found',
  '会话已过期，请刷新页面': 'Session expired. Refresh the page.',
  恢复需要明确确认替换资料库:
    'Restore requires explicit confirmation to replace the library',
  请输入有效的本地地址: 'Enter a valid local address',
  '未找到可访问的 HTML 页面，请确认服务已启动；跳转和自签名证书暂不支持':
    'No accessible HTML page found. Check that the service is running; redirects and self-signed certificates are not supported.',
  设置无效: 'Invalid setting',
  项目不存在: 'Project not found',
  '该目录已有同路径的项目，请先处理重复记录，不会自动合并':
    'This directory already has a project at the same path. Review duplicate records first; nothing will be merged automatically.',
  请先关联项目目录: 'Bind a project directory first',
  请先允许本机截图: 'Allow local screenshots first',
  已忽略的项目不能截图: 'Ignored projects cannot be captured',
  收藏设置无效: 'Invalid favorite setting',
  '名称需要 1–100 个字符': 'Names must contain 1–100 characters',
  不支持的操作: 'Operation is not supported',
  截图不存在: 'Screenshot not found',
  页面不存在: 'Page not found',
  '当前项目无法打开，请重新发现。':
    'Cannot open this project. Rediscover before trying again.',
  '目录或本机文件不存在，请检查路径；截图备份缺文件时可仅导出元数据':
    'A local directory or file is missing. Check the path; export metadata only if backup images are missing.',
  '文件不存在，请先运行 npm run build':
    'File not found. Run npm run build first.',
  操作失败: 'Operation failed',
  '仅支持 localhost、127.0.0.1 或 [::1] 的 HTTP(S) 地址':
    'Only HTTP(S) addresses on localhost, 127.0.0.1, or [::1] are supported',
  '不能添加 Locade 自身': 'Locade cannot add itself',
  '常用端口（lsof 不可用）': 'Common ports (lsof unavailable)',
  '未收到有效 HTML': 'No valid HTML received',
  '页面重定向：请添加最终本地地址':
    'Page redirects: add the final local address',
  '不是成功 HTML 响应': 'Not a successful HTML response',
  读取页面失败: 'Failed to read the page',
  网页探测超时: 'Page probe timed out',
  '连接被拒绝，服务可能已关闭':
    'Connection refused; the service may be stopped',
  '连接或 HTTPS 证书错误': 'Connection or HTTPS certificate error',
  '本轮探测预算已用尽，请稍后刷新': 'Scan budget exhausted; retry later',
  最近探测未确认此地址: 'This address was not confirmed by the latest scan',
  '网页已响应，但暂时无法确认原项目身份，请重新发现':
    'The page responded, but its original project identity is unconfirmed. Rediscover.',
  地址已被其他项目复用: 'Address reused by another project',
  '旧地址已被其他项目复用，请等待原项目重新发现':
    'The old address was reused. Wait for the original project to be rediscovered.',
  '旧地址已被其他项目复用，请重新发现原项目后操作':
    'The old address was reused. Rediscover the original project before continuing.',
  '网页当前不可用，请重新发现': 'The page is unavailable. Rediscover.',
  '页面地址已变化，请重新发现': 'The page address changed. Rediscover.',
  '端口所属项目已变化或暂时无法确认，请重新发现后操作':
    'The port owner changed or is unconfirmed. Rediscover before continuing.',
  '页面身份可能已变化，请重新发现后操作':
    'The page identity may have changed. Rediscover before continuing.',
  不是普通文件: 'Not a regular file',
  元数据文件过大: 'Metadata file is too large',
  请输入已存在的绝对目录路径: 'Enter an existing absolute directory path',
  项目路径不是目录: 'Project path is not a directory',
  '请选择具体项目目录，而不是磁盘或个人目录':
    'Choose a specific project directory, not a disk or home directory',
  '每次请选择 1–100 项记录核对': 'Select 1–100 records per review',
  整理记录无效或重复: 'Review records are invalid or duplicated',
  '记录已变化，请重新载入核对后再确认；本次未修改任何记录':
    'Records changed. Reload before confirming; no records were modified.',
  '打开目录与编辑器当前仅支持 macOS':
    'Opening directories and editors currently requires macOS',
  '仅支持 Finder、VS Code 或 Cursor':
    'Only Finder, VS Code, and Cursor are supported',
  '无法打开所选应用，请确认已安装；也可改用 Finder':
    'Could not open the selected app. Check that it is installed, or use Finder.',
  '截图备份超过 24 MB，请先清理截图或仅备份元数据':
    'Screenshot backup exceeds 24 MB. Remove images first or back up metadata only.',
  备份文件过大: 'Backup file is too large',
  '备份不是有效的 Locade gzip 文件，或解压后超过 48 MB':
    'Not a valid Locade gzip backup, or expanded content exceeds 48 MB',
  备份格式不受支持: 'Backup format is not supported',
  截图备份无效: 'Invalid screenshot backup',
  '备份含无效或过大 PNG': 'Backup contains an invalid or oversized PNG',
  备份图片过大: 'Backup images are too large',
  资料库格式不受支持: 'Library format is not supported',
  自动刷新设置无效: 'Invalid auto-refresh setting',
  项目元数据无效: 'Invalid project metadata',
  项目时间无效: 'Invalid project timestamp',
  项目设置无效: 'Invalid project settings',
  截图元数据无效: 'Invalid screenshot metadata',
  目录关联无效: 'Invalid directory binding',
  'Git 分支信息无效': 'Invalid Git branch information',
  项目地址过多: 'Too many project addresses',
  进程证据无效: 'Invalid process evidence',
  '缺少截图浏览器，请在终端运行 npx playwright install chromium':
    'Screenshot browser missing. In the project terminal, run: npm exec --no -- playwright install chromium',
  '缺少截图浏览器，请在项目目录运行 npm exec --no -- playwright install chromium':
    'Screenshot browser missing. In the project terminal, run: npm exec --no -- playwright install chromium',
  '截图失败：页面超时、证书不受信任或浏览器不可用；仍可直接打开项目':
    'Capture failed: the page timed out, its certificate is untrusted, or the browser is unavailable. You can still open the project.',
  '截图失败：地址未返回 HTML 页面，旧封面未替换；请检查服务后重试':
    'Capture failed: the address did not return HTML. The old cover was not replaced. Check the service and retry.',
  '截图失败：网页返回 HTTP {0}，旧封面未替换；请稍后重试':
    'Capture failed: the page returned HTTP {0}. The old cover was not replaced. Retry later.',
  '截图失败：网页未返回有效响应，旧封面未替换；请稍后重试':
    'Capture failed: no valid response. The old cover was not replaced. Retry later.',
  '无法打开项目 · Locade': 'Cannot open project · Locade',
  '返回 Locade 项目库': 'Return to the Locade library',
  '这次先不打开。': 'Not opening this one yet.',
  '请返回项目库重新发现，确认当前地址与项目身份后再试。Locade 不会替你启动项目或停止其他服务。':
    'Return to the library and rediscover. Confirm the current address and project identity before trying again. Locade will not start your project or stop other services.',
  返回项目库: 'Back to library',
  '你的本地作品，留在这台电脑里。': 'Your local work stays on this computer.',
  'Locade / 本地项目游乐场': 'Locade / Your localhost arcade',
  语言: 'Language',
  跟随浏览器: 'Follow browser',
  使用指南: 'Quick start',
  '先认识你的本地游乐场。': 'Meet your local arcade.',
  '开始使用 Locade': 'Get started with Locade',
  '自行启动项目，再发现': 'Start your project, then discover',
  '在你熟悉的终端或 IDE 启动网页项目。Locade 不运行项目命令，也不停止外部服务。':
    'Start a web project in your usual terminal or IDE. Locade never runs its commands or stops external services.',
  '选择截图，或先只收藏': 'Choose screenshots, or just collect',
  '默认不截图。可先发现、收藏与打开；需要封面时，到隐私设置明确允许，再逐卡生成。':
    'Screenshots start disabled. Discover, favorite, and open first; if you want covers, allow screenshots in privacy settings, then capture each card.',
  以后按画面找回来: 'Find your way back by its cover',
  '关闭项目后卡片与封面仍保留。截图不上传，但可能含秘密；你可以随时禁用或删除。':
    'Cards and covers remain when a project stops. Screenshots are not uploaded but may contain secrets. Disable or delete them anytime.',
  截图浏览器: 'Screenshot browser',
  '正在检查截图依赖…': 'Checking screenshot dependencies…',
  '已找到浏览器文件，实际启动仍可能受系统策略限制。':
    'Browser files found. Launching may still be restricted by system policy.',
  '尚未安装匹配浏览器；不影响发现、收藏和打开项目。':
    'Matching browser not installed. Discovery, favorites, and opening projects still work.',
  '无法确认浏览器状态，请重试。':
    'Could not confirm browser status. Try again.',
  重新检查: 'Check again',
  '在 Locade 源码目录的终端手动执行；不会由网页安装。npm 镜像不改变浏览器下载来源。':
    'Run this manually in the Locade source directory. The web app will not install it. An npm mirror does not change the browser download host.',
  复制安装命令: 'Copy install command',
  '命令已复制；请自行检查并在终端执行。':
    'Command copied. Review it and run it yourself in the terminal.',
  '无法访问剪贴板，请手动选择并复制命令。':
    'Clipboard unavailable. Select and copy the command manually.',
  收起使用指南: 'Hide quick start',
  查看隐私与截图设置: 'Review privacy & screenshots',
  '请求失败，请检查本机服务后重试。':
    'Request failed. Check the local service and try again.',
  重新连接本机资料库: 'Reconnect to local library',
};
