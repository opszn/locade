import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { createApp } from '../server/index.js';
import { probe } from '../server/network.js';
import { capture } from '../server/capture.js';
import { directoryIdentity } from '../server/identity.js';
import { close, listen, fixture } from './helpers.js';
import { decideConfirmation, forbidNativeDialogs } from './browser-helpers.js';
import { APP_VERSION } from '../server/version.js';

test(
  'real browser: discover → consent → screenshot → favorite → open → offline; desktop/mobile layouts',
  { timeout: 60000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'locade-ui-'));
    const local = await fixture();
    let discovered = false;
    const { server, store } = await createApp({
      dataDir,
      discoverProjects: async () => ({
        found: discovered ? [await probe(`${local.url}/`)].filter(Boolean) : [],
        source: 'test fixture',
      }),
    });
    const base = await listen(server);
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await close(server);
      await close(local.server);
      await rm(dataDir, { recursive: true, force: true });
    });
    await mkdir('test-results', { recursive: true });
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 1040 },
      reducedMotion: 'reduce',
    });
    const pageErrors = [];
    forbidNativeDialogs(page, t);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.goto(base);
    await page
      .locator('.version')
      .getByText(`v${APP_VERSION}`, { exact: true })
      .waitFor();
    await page
      .getByRole('heading', { name: '好作品，不该藏在端口里。' })
      .waitFor();
    await page.screenshot({
      path: 'test-results/empty-desktop.png',
      fullPage: true,
    });
    discovered = true;
    await page.getByRole('button', { name: '重新发现' }).click();
    await page.getByRole('heading', { name: 'Sprout Studio' }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: '生成截图' }).isDisabled(),
      true,
    );
    await page.getByRole('button', { name: '隐私与截图' }).click();
    await page.getByRole('checkbox', { name: /允许本机截图/ }).check();
    await page.waitForFunction(
      () => !document.querySelector('dialog input[type="checkbox"]').disabled,
    );
    await page.getByRole('button', { name: '知道了' }).click();
    await page.getByRole('button', { name: '生成截图' }).click();
    await page.locator('.screenshot').waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () => document.querySelector('.screenshot')?.naturalWidth === 1440,
    );
    await page
      .getByRole('button', { name: '收藏 Sprout Studio', exact: true })
      .click();
    await page
      .getByRole('button', { name: '取消收藏 Sprout Studio', exact: true })
      .waitFor();
    await page.screenshot({
      path: 'test-results/library-desktop.png',
      fullPage: true,
    });
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: '打开项目' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(await popup.title(), 'Sprout Studio');
    await popup.close();
    await page.waitForFunction(
      () => !document.querySelector('.nav-item').disabled,
    );
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    await page
      .getByRole('textbox', { name: '本地 HTTP(S) 地址' })
      .fill(`${local.url}/notes`);
    await page.getByRole('button', { name: '添加到项目库' }).click();
    await page.getByRole('heading', { name: 'Field Notes' }).waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `no horizontal overflow at ${width}px`,
      );
      if (width === 390)
        await page.screenshot({
          path: 'test-results/library-mobile.png',
          fullPage: true,
        });
    }
    await page.keyboard.press('/');
    assert.equal(
      await page
        .getByRole('textbox', { name: '搜索项目' })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.getByRole('textbox', { name: '搜索项目' }).fill('no-match');
    await page.getByRole('heading', { name: '还没有匹配的项目' }).waitFor();
    await page.getByRole('textbox', { name: '搜索项目' }).fill('');
    local.setOnline(false);
    await page.getByRole('button', { name: '重新发现' }).click();
    await page.locator('.project-card.offline').first().waitFor();
    assert.equal(await page.locator('.project-card').count(), 2);
    await page.getByRole('button', { name: /我的收藏/ }).click();
    assert.equal(await page.locator('.project-card').count(), 1);
    assert.ok(
      store.state.projects.find((project) => project.favorite).lastOpened,
    );
    await page.getByRole('button', { name: '隐私与截图' }).click();
    await page.getByRole('checkbox', { name: /允许本机截图/ }).click();
    await decideConfirmation(page, '关闭并删除全部截图');
    await page.waitForFunction(
      () => !document.querySelector('dialog input[type="checkbox"]').disabled,
    );
    assert.ok(store.state.projects.every((project) => !project.screenshot));
    await page.getByRole('button', { name: '知道了' }).click();
    assert.deepEqual(pageErrors, []);
  },
);

test(
  'capture blocks management requests and redirects, while preserving existing screenshot on failure',
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-capture-'));
    let managementRequests = 0;
    const management = http.createServer((_request, response) => {
      managementRequests++;
      response.end('must not reach');
    });
    const managementUrl = await listen(management);
    const target = http.createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: managementUrl });
        response.end();
        return;
      }
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<html><title>Isolated</title><body><h1>Local only</h1><img src="${managementUrl}/secret"><img src="/redirect"><script>fetch('${managementUrl}/api/library').catch(()=>{})</script></body></html>`,
      );
    });
    const targetUrl = await listen(target);
    t.after(async () => {
      await close(management);
      await close(target);
      await rm(directory, { recursive: true, force: true });
    });
    const destination = path.join(directory, 'image.png');
    await capture(targetUrl, destination, Number(new URL(managementUrl).port));
    assert.equal(
      (await readFile(destination)).subarray(1, 4).toString(),
      'PNG',
    );
    assert.equal(managementRequests, 0);
    await assert.rejects(
      capture(
        `${targetUrl}/redirect`,
        destination,
        Number(new URL(managementUrl).port),
      ),
    );
    assert.equal(managementRequests, 0);
    assert.equal(
      (await readFile(destination)).subarray(1, 4).toString(),
      'PNG',
    );
  },
);

test(
  'browser project workflow: directories, Git, editor intent, ignoring, exclusion, backup restore and responsive dialogs',
  { timeout: 60000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'locade-details-'));
    const projectDir = path.join(dataDir, 'project');
    await mkdir(path.join(projectDir, '.git'), { recursive: true });
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(projectDir, 'package.json'), '{}');
    await fs.writeFile(
      path.join(projectDir, '.git/HEAD'),
      'ref: refs/heads/feature/library\n',
    );
    const local = await fixture();
    const identity = await directoryIdentity(projectDir, 'auto');
    const editorIntents = [];
    const { server } = await createApp({
      dataDir: path.join(dataDir, 'library'),
      discoverProjects: async () => ({
        found: [
          {
            url: `${local.url}/`,
            title: 'Sprout Studio',
            identity,
            observation: 'fixture:1',
          },
        ],
        source: 'fixture',
      }),
      openProjectDirectory: async (directory, editor) => {
        editorIntents.push({ directory, editor });
      },
    });
    const base = await listen(server);
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await close(server);
      await close(local.server);
      await rm(dataDir, { recursive: true, force: true });
    });
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 1080 },
      reducedMotion: 'reduce',
    });
    const errors = [];
    forbidNativeDialogs(page, t);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await page.getByRole('heading', { name: 'Sprout Studio' }).waitFor();
    await page
      .getByRole('button', { name: 'Sprout Studio 的目录与详情' })
      .click();
    const details = page.getByRole('dialog', { name: 'Sprout Studio' });
    await details.getByText('Git · feature/library', { exact: true }).waitFor();
    await details
      .getByRole('textbox', { name: '应用目录（绝对路径）' })
      .fill(projectDir);
    await details.getByRole('button', { name: '保存目录关联' }).click();
    await details.getByText('手动关联', { exact: true }).waitFor();
    await details
      .getByRole('combobox', { name: '回到开发现场' })
      .selectOption('vscode');
    await details.getByRole('button', { name: '打开所选应用' }).click();
    await page.waitForFunction(
      () =>
        !document.querySelector('dialog[open] button[type="submit"]')?.disabled,
    );
    assert.equal(editorIntents[0].editor, 'vscode');
    await details
      .getByRole('checkbox', { name: '此项目允许截图', exact: true })
      .click();
    await decideConfirmation(page, '禁止截图并删除封面');
    await page.waitForFunction(
      () =>
        !document.querySelector('dialog[open] input[type="checkbox"]').checked,
    );
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
    await page.screenshot({
      path: 'test-results/project-details-mobile.png',
      fullPage: true,
    });
    await details.getByRole('button', { name: '忽略此项目' }).click();
    await decideConfirmation(page, '移至已忽略');
    await page.getByRole('button', { name: /已忽略/ }).click();
    await page.getByRole('heading', { name: 'Sprout Studio' }).waitFor();
    await page
      .getByRole('button', { name: 'Sprout Studio 的目录与详情' })
      .click();
    await details.getByRole('button', { name: '恢复到项目库' }).click();
    await page.getByRole('button', { name: /全部项目/ }).click();
    await page.getByRole('heading', { name: 'Sprout Studio' }).waitFor();
    await page.getByRole('button', { name: '隐私与截图' }).click();
    const settings = page.getByRole('dialog', { name: '你的页面，你做决定。' });
    const downloadPromise = page.waitForEvent('download');
    await settings.getByRole('button', { name: '导出本地备份' }).click();
    const download = await downloadPromise;
    const file = path.join(dataDir, 'backup.json.gz');
    await download.saveAs(file);
    assert.ok((await fs.stat(file)).size > 0);
    const beforeRestoreId = await page
      .locator('.project-card')
      .first()
      .getAttribute('data-project-id');
    await settings.getByLabel('选择 Locade 备份').setInputFiles(file);
    await decideConfirmation(page, '确认替换并恢复');
    await page.waitForFunction((previous) => {
      const current = document
        .querySelector('.project-card')
        ?.getAttribute('data-project-id');
      return current && current !== previous;
    }, beforeRestoreId);
    await settings.getByRole('button', { name: '知道了' }).click();
    await page.getByRole('heading', { name: 'Sprout Studio' }).waitFor();
    await page
      .getByRole('button', { name: 'Sprout Studio 的目录与详情' })
      .click();
    await details.getByText('手动关联', { exact: true }).waitFor();
    await details.getByRole('button', { name: '完成' }).click();
    assert.deepEqual(errors, []);
  },
);

test(
  'foreground refresh uses its interval, pauses during editing/dialogs/menus, resumes and respects opt-out',
  { timeout: 30000 },
  async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'locade-refresh-'));
    let scans = 0;
    const { server } = await createApp({
      dataDir,
      discoverProjects: async () => {
        scans++;
        return {
          found: [{ url: 'http://127.0.0.1:3000/', title: 'Refresh fixture' }],
          source: 'fixture',
        };
      },
    });
    const base = await listen(server);
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await close(server);
      await rm(dataDir, { recursive: true, force: true });
    });
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 1040 },
      reducedMotion: 'reduce',
    });
    forbidNativeDialogs(page, t);
    page.setDefaultTimeout(3000);
    const now = new Date('2026-10-21T01:00:00+08:00');
    await page.clock.install({ time: now });
    await page.goto(base);
    const refresh = page.getByRole('button', { name: '重新发现', exact: true });
    const ready = () =>
      page
        .locator('button:not([disabled])')
        .filter({ hasText: /^重新发现$/ })
        .waitFor();
    await ready();
    assert.equal(scans, 1);
    await page.clock.pauseAt(new Date(now.getTime() + 1000));
    const nextScan = async () => {
      const count = scans;
      const done = page.waitForResponse(
        (r) =>
          r.url() === `${base}/api/scan` && r.request().method() === 'POST',
      );
      await page.clock.runFor(20000);
      await done;
      await ready();
      assert.equal(scans, count + 1);
    };
    await nextScan();
    const search = page.getByRole('textbox', { name: '搜索项目' });
    await search.fill('Refresh');
    const count = scans;
    await page.clock.runFor(40000);
    assert.equal(scans, count);
    // Tab moves focus out of the field without issuing a manual scan.
    await search.press('Tab');
    await nextScan();
    await page.getByRole('button', { name: '隐私与截图' }).click();
    const dialogCount = scans;
    await page.clock.runFor(40000);
    assert.equal(scans, dialogCount);
    await page.getByRole('button', { name: '知道了' }).click();
    await nextScan();
    const menu = page.getByLabel('Refresh fixture 的更多操作');
    await menu.click();
    const menuCount = scans;
    await page.clock.runFor(40000);
    assert.equal(scans, menuCount);
    await menu.click();
    await nextScan();
    await page.getByRole('button', { name: '隐私与截图' }).click();
    await page
      .getByRole('checkbox', { name: '前台自动发现', exact: true })
      .uncheck();
    await page
      .locator('input[aria-label="前台自动发现"]:not([disabled])')
      .waitFor();
    await page.getByRole('button', { name: '知道了' }).click();
    const disabledCount = scans;
    await page.clock.runFor(60000);
    assert.equal(scans, disabledCount);
    await refresh.click();
    await ready();
    assert.equal(scans, disabledCount + 1);
  },
);
