import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { createApp } from '../server/index.js';
import { directoryIdentity } from '../server/identity.js';
import { close, listen } from './helpers.js';
import { decideConfirmation, forbidNativeDialogs } from './browser-helpers.js';

function privateEntry(server) {
  const entry = `/${randomUUID()}/`;
  const handlers = server.listeners('request');
  assert.equal(handlers.length, 1);
  server.removeAllListeners('request');
  server.on('request', (request, response) => {
    if (request.url === '/') {
      response.writeHead(404);
      response.end();
      return;
    }
    if (request.url === entry) request.url = '/';
    return handlers[0](request, response);
  });
  return entry;
}

test(
  'same-name review preserves all records by default, explicitly ignores selections, detects stale undo and supports recovery',
  { timeout: 60000 },
  async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'locade-duplicate-ui-'));
    const root = path.join(dir, 'a-long-repository-name', 'frontend');
    await mkdir(root, { recursive: true });
    const identities = [
      null,
      null,
      await directoryIdentity(path.dirname(root), 'auto'),
      await directoryIdentity(root, 'auto'),
    ];
    const { server, store } = await createApp({
      dataDir: path.join(dir, 'data'),
      discoverProjects: async () => ({ found: [] }),
    });
    await store.transaction(async () => {
      store.state.autoRefresh = false;
      store.state.screenshotsEnabled = true;
      for (const port of [3310, 3311])
        store.upsert({
          url: `http://127.0.0.1:${port}/`,
          title: 'Another comparison group',
        });
      for (let i = 0; i < 4; i++) {
        const p = store.upsert({
          url: `http://127.0.0.1:${3300 + i}/`,
          title: 'A shared local project title',
          identity: identities[i],
          observation: i < 2 ? null : `${i}:fixture`,
        });
        if (i === 0) {
          p.favorite = true;
          p.screenshot = new Date().toISOString();
          await writeFile(
            path.join(store.screenshots, `${p.id}.png`),
            Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              'base64',
            ),
          );
          p.endpoints.push({
            url: 'http://localhost:3499/history',
            online: false,
            observation: null,
          });
        }
      }
    });
    const original = structuredClone(
      store.state.projects.filter(
        (project) => project.name === 'A shared local project title',
      ),
    );
    const coverFile = path.join(store.screenshots, `${original[0].id}.png`);
    const coverHash = createHash('sha256')
      .update(await readFile(coverFile))
      .digest('hex');
    const entry = privateEntry(server);
    const base = await listen(server);
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await close(server);
      await rm(dir, { recursive: true, force: true });
    });
    const page = await browser.newPage({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    const errors = [];
    forbidNativeDialogs(page, t);
    await mkdir('test-results', { recursive: true });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}${entry}`);
    await page
      .getByRole('button', { name: '核对同名记录', exact: true })
      .waitFor();
    assert.equal(await page.locator('.project-card').count(), 6);
    await page.getByRole('textbox', { name: '搜索项目' }).fill('3499');
    assert.equal(await page.locator('.project-card').count(), 1);
    await page
      .getByRole('textbox', { name: '搜索项目' })
      .fill('A shared local project title');
    await page
      .getByRole('button', { name: '核对同名记录', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: '同名项目，逐项核对。' });
    await dialog.waitFor();
    assert.equal(await dialog.locator('.duplicate-item').count(), 4);
    assert.equal(
      await dialog.getByRole('checkbox', { checked: true }).count(),
      0,
    );
    assert.ok(
      await dialog
        .getByRole('button', { name: '移至已忽略（0）' })
        .isDisabled(),
    );
    assert.ok((await dialog.innerText()).includes(root));
    await dialog.getByRole('checkbox').nth(0).check();
    await dialog.getByRole('checkbox').nth(1).check();
    await dialog.getByRole('button', { name: '移至已忽略（2）' }).click();
    await decideConfirmation(page);
    assert.equal(store.state.projects.filter((p) => p.hidden).length, 0);
    await dialog.getByRole('button', { name: '关闭同名核对' }).click();
    await page
      .getByRole('button', { name: '核对同名记录', exact: true })
      .click();
    assert.equal(
      await dialog.getByRole('checkbox', { checked: true }).count(),
      0,
    );
    await dialog.getByRole('checkbox').nth(0).check();
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: '核对同名记录', exact: true })
      .click();
    assert.equal(
      await dialog.getByRole('checkbox', { checked: true }).count(),
      0,
    );
    await dialog.getByRole('checkbox').nth(0).check();
    await dialog.getByRole('checkbox').nth(1).check();
    await dialog.getByRole('button', { name: '移至已忽略（2）' }).click();
    await decideConfirmation(page, '移至已忽略（2）');
    await dialog.getByRole('status').filter({ hasText: '已将 2 项' }).waitFor();
    assert.equal(store.state.projects.filter((p) => p.hidden).length, 2);
    for (const old of original) {
      const p = store.state.projects.find((p) => p.id === old.id);
      assert.equal(p.name, old.name);
      assert.equal(p.favorite, old.favorite);
      assert.equal(p.screenshot, old.screenshot);
      assert.deepEqual(p.identity, old.identity);
    }
    assert.equal(
      createHash('sha256')
        .update(await readFile(coverFile))
        .digest('hex'),
      coverHash,
    );
    await dialog.getByRole('button', { name: '撤销本次操作' }).click();
    await dialog.getByRole('status').filter({ hasText: '已撤销' }).waitFor();
    assert.equal(store.state.projects.filter((p) => p.hidden).length, 0);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.ok(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      if (width === 390)
        await page.screenshot({
          path: 'test-results/duplicates-review-mobile.png',
          fullPage: true,
        });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: 'test-results/duplicates-review-desktop.png',
      fullPage: true,
    });
    await dialog.getByRole('checkbox').nth(0).check();
    await dialog.getByRole('button', { name: '移至已忽略（1）' }).click();
    await decideConfirmation(page, '移至已忽略（1）');
    await dialog.getByRole('status').filter({ hasText: '已将 1 项' }).waitFor();
    const library = await (await fetch(`${base}/api/library`)).json();
    await fetch(`${base}/api/projects/${original[0].id}`, {
      method: 'PATCH',
      headers: { 'X-Locade-Token': library.token },
      body: JSON.stringify({ favorite: false }),
    });
    await dialog.getByRole('button', { name: '撤销本次操作' }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(
      store.state.projects.find((project) => project.id === original[0].id)
        .hidden,
      true,
    );
    assert.equal(
      store.state.projects.find((project) => project.id === original[0].id)
        .favorite,
      false,
    );
    await dialog.getByRole('button', { name: '重新载入核对' }).click();
    await dialog
      .getByRole('status')
      .filter({ hasText: '已重新载入' })
      .waitFor();
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: /已忽略/ }).click();
    await page
      .getByRole('button', {
        name: 'A shared local project title 的目录与详情',
      })
      .click();
    await page.getByRole('button', { name: '恢复到项目库' }).click();
    await page.getByRole('button', { name: /全部项目/ }).click();
    assert.equal(await page.locator('.project-card').count(), 4);
    assert.equal(
      createHash('sha256')
        .update(await readFile(coverFile))
        .digest('hex'),
      coverHash,
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'stale browser links go through current server ownership checks instead of opening a replacement project',
  { timeout: 30000 },
  async (t) => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), 'locade-stale-navigation-'),
    );
    const route = `/${randomUUID()}/`;
    let targetRequests = 0;
    const target = http.createServer((req, res) => {
      if (req.url !== route) {
        res.writeHead(404);
        res.end();
        return;
      }
      targetRequests++;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<title>Owner B</title>');
    });
    const targetBase = await listen(target);
    for (const name of ['a', 'b']) await mkdir(path.join(dir, name));
    const a = await directoryIdentity(path.join(dir, 'a'), 'auto');
    const b = await directoryIdentity(path.join(dir, 'b'), 'auto');
    let current = {
      url: `${targetBase}${route}`,
      title: 'Owner A',
      identity: a,
      observation: '101:old',
    };
    const { server, store } = await createApp({
      dataDir: path.join(dir, 'data'),
      discoverProjects: async () => ({ found: [current] }),
      inspectProject: async () => current,
    });
    await store.transaction(() => {
      store.state.autoRefresh = false;
    });
    const entry = privateEntry(server);
    const base = await listen(server);
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await close(server);
      await close(target);
      await rm(dir, { recursive: true, force: true });
    });
    const page = await browser.newPage({ locale: 'zh-CN' });
    forbidNativeDialogs(page, t);
    page.setDefaultTimeout(5000);
    await page.goto(`${base}${entry}`);
    await page.getByRole('heading', { name: 'Owner A' }).waitFor();
    const library = await (await fetch(`${base}/api/library`)).json();
    const original = library.projects[0];
    assert.equal(
      await page.getByRole('link', { name: '打开项目' }).getAttribute('href'),
      `/open/${original.id}?lang=zh-CN`,
    );
    current = {
      ...current,
      title: 'Owner B',
      identity: b,
      observation: '202:new',
    };
    await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'X-Locade-Token': library.token },
      body: '{}',
    });
    assert.equal(
      store.state.projects.find((p) => p.id === original.id).addressReused,
      true,
    );
    for (const button of ['left', 'middle']) {
      await page.bringToFront();
      const popupPromise = page
        .context()
        .waitForEvent('page', { timeout: 5000 });
      await page.getByRole('link', { name: '打开项目' }).click({ button });
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.match(
        await popup.locator('body').innerText(),
        /地址已被其他项目复用/,
      );
      assert.notEqual(await popup.title(), 'Owner B');
      await popup.getByRole('heading', { name: '这次先不打开。' }).waitFor();
      assert.equal(
        await popup
          .getByRole('link', { name: '返回项目库', exact: true })
          .getAttribute('href'),
        '/',
      );
      if (button === 'left') {
        await popup.setViewportSize({ width: 1440, height: 900 });
        await popup.screenshot({
          path: 'test-results/owned-navigation-error-desktop.png',
        });
        await popup.setViewportSize({ width: 320, height: 640 });
        assert.equal(
          await popup.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await popup.screenshot({
          path: 'test-results/owned-navigation-error-mobile.png',
        });
      }
      await popup.close();
    }
    assert.equal(targetRequests, 0);
    assert.equal(
      store.state.projects.find((p) => p.id === original.id).lastOpened,
      null,
    );
  },
);
