import { chromium } from 'playwright';
import { localUrl } from './network.js';

class CaptureNavigationError extends Error {}

export async function capture(url, destination, excludedPort) {
  localUrl(url, excludedPort);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: 10000,
      executablePath: process.env.LOCADE_BROWSER_EXECUTABLE || undefined,
      args: ['--host-resolver-rules=MAP localhost 127.0.0.1'],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    // Fetch with redirects disabled: a local redirect must not bypass URL checks.
    await context.route('**/*', async (route) => {
      try {
        localUrl(route.request().url(), excludedPort);
        const response = await route.fetch({ maxRedirects: 0, timeout: 6000 });
        if (response.status() >= 300 && response.status() < 400)
          return await route.abort();
        await route.fulfill({ response });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 6000,
    });
    if (!response?.ok())
      throw new CaptureNavigationError(
        `截图失败：网页${response ? `返回 HTTP ${response.status()}` : '未返回有效响应'}，旧封面未替换；请稍后重试`,
      );
    if (
      !/(?:text\/html|application\/xhtml\+xml)/i.test(
        response.headers()['content-type'] || '',
      )
    )
      throw new CaptureNavigationError(
        '截图失败：地址未返回 HTML 页面，旧封面未替换；请检查服务后重试',
      );
    await page.waitForTimeout(700);
    await page.screenshot({
      path: destination,
      type: 'png',
      animations: 'disabled',
      timeout: 5000,
    });
  } catch (error) {
    if (error instanceof CaptureNavigationError) throw error;
    if (error.message.includes("Executable doesn't exist")) {
      throw new Error(
        '缺少截图浏览器，请在终端运行 npx playwright install chromium',
      );
    }
    throw new Error(
      '截图失败：页面超时、证书不受信任或浏览器不可用；仍可直接打开项目',
    );
  } finally {
    await browser?.close();
  }
}
