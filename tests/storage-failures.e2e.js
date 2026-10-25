import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  stat,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index.js';
import { exportBackup } from '../server/backup.js';
import { createTranslator } from '../server/i18n.js';
import { listen, close } from './helpers.js';
import { forbidNativeDialogs, decideConfirmation } from './browser-helpers.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64',
);

async function setup(t, locale = 'en') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-storage-ui-'));
  const current = {
    url: 'http://127.0.0.1:3000/',
    title: 'Owned storage fixture',
    observation: '101:owned',
  };
  let captures = 0;
  const app = await createApp({
    dataDir: directory,
    discoverProjects: async () => ({
      found: [current],
      source: 'owned storage test',
    }),
    inspectProject: async () => current,
    capturePage: async (_url, file) =>
      writeFile(file, Buffer.concat([png, Buffer.from(`${++captures}`)])),
  });
  await app.store.transaction(async () => {
    app.store.state.autoRefresh = false;
    app.store.state.screenshotsEnabled = true;
    const project = app.store.upsert(current);
    project.favorite = true;
    await app.store.stageScreenshot(project, (file) => writeFile(file, png));
  });
  const original = structuredClone(app.store.state.projects[0]);
  const handler = app.server.listeners('request')[0];
  const entry = `/${randomUUID()}/`;
  app.server.removeAllListeners('request');
  app.server.on('request', (request, response) => {
    if (request.url === '/') {
      response.writeHead(404);
      response.end();
      return;
    }
    if (request.url === entry) request.url = '/';
    handler(request, response);
  });
  const base = await listen(app.server);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale,
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('locade.guide.hidden', '1');
    } catch {
      /* about:blank has no storage origin. */
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  context.on('page', (p) =>
    p.on('pageerror', (error) => errors.push(error.message)),
  );
  page.on('pageerror', (error) => errors.push(error.message));
  forbidNativeDialogs(page, t);
  t.after(async () => {
    await browser.close();
    await close(app.server);
    await app.release();
    await rm(directory, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelector('.toolbar-actions .quiet')?.disabled === false,
    );
  await page.goto(base + entry);
  await ready();
  return {
    ...app,
    page,
    context,
    base,
    entry,
    original,
    t: createTranslator(locale),
    ready,
  };
}

for (const locale of ['en', 'zh-CN']) {
  test(
    `storage failures (${locale}): committed deletion warns honestly, retry clears it, and failed recapture keeps the old cover in both windows`,
    { timeout: 45000 },
    async (t) => {
      const s = await setup(t, locale);
      const file = s.store.screenshotPath(s.original);
      let deny = true;
      const remove = s.store.io.rm;
      t.mock.method(s.store.io, 'rm', async (target, options) => {
        if (deny && path.dirname(target) === s.store.screenshots)
          throw Object.assign(new Error('controlled cleanup EACCES'), {
            code: 'EACCES',
          });
        return remove(target, options);
      });
      await s.page
        .getByRole('button', { name: s.t(' 隐私与截图 ').trim(), exact: true })
        .click();
      const settings = s.page.locator(
        'dialog[aria-labelledby="settings-title"]',
      );
      await settings
        .getByRole('checkbox', { name: s.t('允许本机截图'), exact: true })
        .click();
      const disabled = s.page.waitForResponse(
        (response) =>
          response.url() === `${s.base}/api/settings` &&
          response.request().method() === 'PATCH',
      );
      await decideConfirmation(s.page, s.t('关闭并删除全部截图'));
      assert.equal((await disabled).status(), 200);
      await s.ready();
      const warning = () =>
        s.page
          .getByRole('alert', { name: s.t('本机图片清理未完成') })
          .filter({ visible: true });
      await warning().waitFor();
      assert.equal(
        await settings
          .getByRole('checkbox', { name: s.t('允许本机截图'), exact: true })
          .isChecked(),
        false,
      );
      assert.match(await warning().innerText(), /EACCES/);
      assert.ok(await stat(file));
      assert.equal(
        (
          await s.page.request.get(`${s.base}/screenshots/${s.original.id}.png`)
        ).status(),
        404,
      );
      assert.equal(
        await settings
          .getByText(s.t('本机截图已关闭，全部现有封面已删除。'), {
            exact: true,
          })
          .count(),
        0,
      );
      await settings
        .getByRole('button', { name: s.t('知道了'), exact: true })
        .click();
      await s.page.reload();
      await s.ready();
      await warning().waitFor();
      await mkdir('test-results/alpha2-data-integrity', {
        recursive: true,
        mode: 0o700,
      });
      for (const width of [1440, 390, 320]) {
        await s.page.setViewportSize({
          width,
          height: width === 1440 ? 1000 : 844,
        });
        assert.equal(
          await s.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await s.page.screenshot({
          path: `test-results/alpha2-data-integrity/warning-${locale}-${width}.png`,
          fullPage: true,
        });
      }
      deny = false;
      const retry = s.page.waitForResponse(
        (response) => response.url() === `${s.base}/api/storage/cleanup`,
      );
      await warning()
        .getByRole('button', { name: s.t('重试图片清理'), exact: true })
        .click();
      assert.equal((await retry).status(), 200);
      await s.ready();
      assert.equal(await warning().count(), 0);
      assert.deepEqual(await readdir(s.store.screenshots), []);
      assert.equal(s.store.state.projects[0].favorite, true);
      await s.store.transaction(async () => {
        s.store.state.screenshotsEnabled = true;
        await s.store.stageScreenshot(s.store.state.projects[0], (target) =>
          writeFile(target, png),
        );
      });
      await s.page.reload();
      await s.ready();
      const oldFile = s.store.screenshotPath(s.store.state.projects[0]);
      const before = await readFile(s.store.file);
      const rename = s.store.io.rename;
      let fail = true;
      t.mock.method(s.store.io, 'rename', async (from, to) => {
        if (fail && to === s.store.file)
          throw Object.assign(new Error('controlled metadata EIO'), {
            code: 'EIO',
          });
        return rename(from, to);
      });
      const rejected = s.page.waitForResponse(
        (response) =>
          response.url().endsWith('/screenshot') &&
          response.request().method() === 'POST',
      );
      await s.page.locator('.capture-button').click();
      assert.equal((await rejected).status(), 400);
      await s.ready();
      await s.page
        .getByRole('alert')
        .filter({ hasText: 'controlled metadata EIO' })
        .waitFor();
      assert.deepEqual(await readFile(s.store.file), before);
      assert.deepEqual(await readFile(oldFile), png);
      assert.deepEqual(await readdir(s.store.screenshots), [
        path.basename(oldFile),
      ]);
      const second = await s.context.newPage();
      await second.goto(s.base + s.entry);
      await second.locator('.project-card img.screenshot').waitFor();
      assert.equal(
        await second.locator('.project-card h3').innerText(),
        s.original.name,
      );
      assert.deepEqual(
        Buffer.from(
          await (
            await second.request.get(
              `${s.base}/screenshots/${s.original.id}.png`,
            )
          ).body(),
        ),
        png,
      );
      await second.close();
      fail = false;
      const saved = s.page.waitForResponse(
        (response) =>
          response.url().endsWith('/screenshot') &&
          response.request().method() === 'POST',
      );
      await s.page.locator('.capture-button').click();
      assert.equal((await saved).status(), 200);
      await s.ready();
      assert.notEqual(
        s.store.screenshotPath(s.store.state.projects[0]),
        oldFile,
      );
      await assert.rejects(stat(oldFile), { code: 'ENOENT' });
      assert.equal((await readdir(s.store.screenshots)).length, 1);
    },
  );
}

test(
  'failed image restoration updates the owned error and cleanup UI without replacing the original cards',
  { timeout: 30000 },
  async (t) => {
    const s = await setup(t);
    const archive = await exportBackup(s.store, true);
    const before = await readFile(s.store.file);
    const old = s.store.screenshotPath(s.original);
    const write = s.store.io.writeFile;
    const remove = s.store.io.rm;
    let fail = true;
    t.mock.method(s.store.io, 'writeFile', async (file, data, options) => {
      if (fail && path.dirname(file) === s.store.screenshots) {
        await writeFile(file, data.subarray(0, 20));
        throw Object.assign(new Error('controlled restore ENOSPC'), {
          code: 'ENOSPC',
        });
      }
      return write(file, data, options);
    });
    t.mock.method(s.store.io, 'rm', async (file, options) => {
      if (fail && path.dirname(file) === s.store.screenshots && file !== old)
        throw Object.assign(new Error('controlled cleanup EACCES'), {
          code: 'EACCES',
        });
      return remove(file, options);
    });
    await s.page
      .getByRole('button', { name: 'Privacy & screenshots', exact: true })
      .click();
    const settings = s.page.locator('dialog[aria-labelledby="settings-title"]');
    const restore = async () => {
      await settings.getByLabel('Choose a Locade backup').setInputFiles({
        name: 'owned-fixture.json.gz',
        mimeType: 'application/gzip',
        buffer: archive,
      });
      const confirmation = s.page.getByRole('alertdialog');
      await confirmation
        .getByRole('checkbox', { name: s.t('同时恢复备份中的截图') })
        .check();
      const response = s.page.waitForResponse(
        (result) => result.url() === `${s.base}/api/restore`,
      );
      await decideConfirmation(s.page, 'Replace and restore');
      const result = await response;
      await s.ready();
      return result;
    };
    assert.equal((await restore()).status(), 400);
    await settings
      .getByRole('alert')
      .filter({ hasText: 'controlled restore ENOSPC' })
      .waitFor();
    await settings
      .getByRole('alert', { name: 'Local image cleanup is incomplete' })
      .waitFor();
    assert.deepEqual(await readFile(s.store.file), before);
    assert.equal(s.store.state.projects[0].id, s.original.id);
    assert.deepEqual(await readFile(old), png);
    fail = false;
    await settings
      .getByRole('button', { name: 'Retry image cleanup', exact: true })
      .click();
    await s.ready();
    assert.equal((await restore()).status(), 200);
    assert.notEqual(s.store.state.projects[0].id, s.original.id);
    assert.equal(s.store.state.projects[0].favorite, true);
    assert.deepEqual(
      await readFile(s.store.screenshotPath(s.store.state.projects[0])),
      png,
    );
    assert.equal((await readdir(s.store.screenshots)).length, 1);
  },
);
