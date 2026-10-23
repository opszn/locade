const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );

export function sendNavigationError(response, message) {
  response.writeHead(400, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>无法打开项目 · Locade</title><link rel="stylesheet" href="/navigation-error.css"></head><body><main><a href="/" aria-label="返回 Locade 项目库"><img src="/brand/locade-wordmark.svg" alt="locade"></a><div class="rule"></div><span class="eyebrow">LOCAL / CHECK BEFORE OPENING</span><h1>这次先不打开。</h1><p role="alert">${escape(message)}</p><p class="help">请返回项目库重新发现，确认当前地址与项目身份后再试。Locade 不会替你启动项目或停止其他服务。</p><a class="button" href="/">返回项目库 <span aria-hidden="true">↗</span></a><footer>你的本地作品，留在这台电脑里。</footer></main></body></html>`,
  );
}
