import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { createApp } from '../server/index.js';
import { directoryIdentity } from '../server/identity.js';
import { close, listen } from './helpers.js';
import { decideConfirmation, forbidNativeDialogs } from './browser-helpers.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64',
);
const digest = (content) => createHash('sha256').update(content).digest('hex');

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-interaction-'));
  const app = await createApp({
    dataDir: path.join(root, 'data'),
    discoverProjects: async () => ({
      found: [],
      source: 'controlled interaction audit',
    }),
    openProjectDirectory: async () => {},
  });
  const directories = [];
  for (let index = 0; index < 5; index++) {
    const directory = path.join(
      root,
      'a-long-but-controlled-project-directory-for-layout-verification',
      `application-${index}`,
    );
    await mkdir(directory, { recursive: true });
    directories.push(await realpath(directory));
  }
  await app.store.transaction(async () => {
    app.store.state.autoRefresh = false;
    app.store.state.screenshotsEnabled = true;
    for (let index = 0; index < 5; index++) {
      const project = app.store.upsert({
        url: `http://127.0.0.1:${34000 + index}/${randomUUID()}/`,
        title:
          index < 4 ? 'Interaction review project' : 'Another local project',
        identity: await directoryIdentity(directories[index], 'manual'),
        observation: `controlled-${index}`,
      });
      if (index < 4) {
        project.screenshot = '2026-10-22T00:00:00.000Z';
        await writeFile(
          path.join(app.store.screenshots, `${project.id}.png`),
          png,
        );
      }
    }
  });
  const projects = structuredClone(app.store.state.projects);
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
  const page = await browser.newPage({
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  const mutations = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      request.url().startsWith(base + '/api/') &&
      request.method() !== 'GET' &&
      !request.url().endsWith('/scan')
    )
      mutations.push(request.url());
  });
  forbidNativeDialogs(page, t);
  t.after(async () => {
    await browser.close();
    await close(app.server);
    await app.release();
    await rm(root, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const ready = () =>
    page.waitForFunction(
      () =>
        document.querySelector('.toolbar-actions .quiet')?.disabled === false,
    );
  const reload = async () => {
    await page.goto(base + entry);
    await ready();
  };
  const commit = async (label) => {
    const done = page.waitForResponse(
      (response) =>
        response.url().startsWith(base + '/api/') &&
        response.request().method() !== 'GET' &&
        !response.url().endsWith('/scan'),
    );
    await decideConfirmation(page, label);
    await (await done).finished();
    await ready();
  };
  const card = (id) => page.locator(`[data-project-id="${id}"]`);
  const details = page.locator('dialog[aria-labelledby="details-title"]');
  const openDetails = async (id) => {
    await card(id).locator('.project-binding').click();
    await details.waitFor();
  };
  const cover = (id) => path.join(app.store.screenshots, `${id}.png`);
  const seedCovers = async () => {
    await app.store.transaction(async () => {
      app.store.state.screenshotsEnabled = true;
      for (const project of app.store.state.projects) {
        project.captureAllowed = true;
        project.screenshot = '2026-10-22T00:00:00.000Z';
        await writeFile(cover(project.id), png);
      }
    });
    await reload();
  };
  await mkdir('test-results', { recursive: true });
  await reload();
  return {
    ...app,
    root,
    page,
    base,
    projects,
    directories,
    ready,
    reload,
    commit,
    card,
    details,
    openDetails,
    cover,
    seedCovers,
    mutations,
  };
}

test(
  'owned confirmations cover every destructive action, preserve cancellation, focus and responsive long summaries',
  { timeout: 90000 },
  async (t) => {
    const ctx = await setup(t);
    const {
      page,
      store,
      projects,
      directories,
      ready,
      commit,
      card,
      details,
      openDetails,
      cover,
      seedCovers,
      mutations,
    } = ctx;
    const id = projects[0].id;
    const current = () => store.state.projects.find((p) => p.id === id);
    const confirmation = page.getByRole('alertdialog');
    await page
      .getByRole('button', { name: '核对同名记录', exact: true })
      .click();
    const review = page.getByRole('dialog', { name: '同名项目，逐项核对。' });
    for (const choice of await review.getByRole('checkbox').all())
      await choice.check();
    const trigger = review.getByRole('button', {
      name: '移至已忽略（4）',
      exact: true,
    });
    const before = mutations.length;
    await trigger.click();
    await confirmation.waitFor();
    assert.equal(
      await confirmation
        .getByRole('button', { name: '取消', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    for (const project of projects.slice(0, 4))
      assert.ok(
        (await confirmation.innerText()).includes(project.id.slice(0, 8)),
      );
    await page.keyboard.press('Escape');
    await confirmation.waitFor({ state: 'detached' });
    assert.equal(mutations.length, before);
    assert.equal(store.state.projects.filter((p) => p.hidden).length, 0);
    assert.equal(
      await trigger.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await review.getByRole('checkbox', { checked: true }).count(),
      4,
    );
    await trigger.click();
    await page.keyboard.press('Enter');
    await confirmation.waitFor({ state: 'detached' });
    assert.equal(
      mutations.length,
      before,
      'Enter defaults to cancellation, not the destructive action',
    );
    await trigger.click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 640,
      });
      assert.equal(
        await confirmation.evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      const footer = await confirmation
        .locator('.confirmation-actions')
        .boundingBox();
      assert.ok(
        footer.y >= 0 &&
          footer.y + footer.height <= (width === 1440 ? 1000 : 640),
      );
      await page.screenshot({
        path: `test-results/owned-confirmation-${width}.png`,
      });
      if (width === 1440)
        await confirmation.screenshot({
          path: 'test-results/owned-confirmation-panel.png',
        });
      if (width === 320) {
        const content = confirmation.getByRole('region', { name: '操作详情' });
        await content.evaluate(
          (element) => (element.scrollTop = element.scrollHeight),
        );
        const last = await confirmation
          .locator('.confirmation-items li')
          .last()
          .boundingBox();
        const bounds = await content.boundingBox();
        assert.ok(
          last.y >= bounds.y &&
            last.y + last.height <= bounds.y + bounds.height,
        );
        await content.evaluate((element) => (element.scrollTop = 0));
      }
    }
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Tab');
      assert.equal(
        await confirmation.evaluate((el) =>
          el.contains(document.activeElement),
        ),
        true,
      );
    }
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('Shift+Tab');
      assert.equal(
        await confirmation.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        true,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await commit('移至已忽略（4）');
    await review.getByRole('status').filter({ hasText: '已将 4 项' }).waitFor();
    assert.equal(store.state.projects.filter((p) => p.hidden).length, 4);
    assert.equal(digest(await readFile(cover(id))), digest(png));
    await review.getByRole('button', { name: '撤销本次操作' }).click();
    await review.getByRole('status').filter({ hasText: '已撤销' }).waitFor();
    await review.getByRole('button', { name: '完成', exact: true }).click();

    await openDetails(id);
    await details.getByRole('button', { name: '忽略此项目' }).click();
    await decideConfirmation(page);
    assert.equal(current().hidden, false);
    await details.getByRole('button', { name: '忽略此项目' }).click();
    await commit('移至已忽略');
    await page.getByRole('button', { name: /^已忽略/ }).click();
    await openDetails(id);
    await details.getByRole('button', { name: '恢复到项目库' }).click();
    await ready();
    await page.getByRole('button', { name: /^全部项目/ }).click();
    assert.equal(current().hidden, false);

    await openDetails(id);
    const permission = details.getByRole('checkbox', {
      name: '此项目允许截图',
      exact: true,
    });
    await permission.click();
    await decideConfirmation(page);
    assert.equal(await permission.isChecked(), true);
    assert.equal(digest(await readFile(cover(id))), digest(png));
    await permission.click();
    await commit('禁止截图并删除封面');
    assert.equal(current().captureAllowed, false);
    assert.equal(current().screenshot, null);
    await seedCovers();

    await openDetails(id);
    const directory = details.getByRole('textbox', {
      name: '应用目录（绝对路径）',
    });
    await directory.fill(directories[4]);
    await details.getByRole('button', { name: '保存目录关联' }).click();
    await decideConfirmation(page);
    assert.equal(current().identity.directory, directories[0]);
    assert.equal(digest(await readFile(cover(id))), digest(png));
    await details.getByRole('button', { name: '保存目录关联' }).click();
    await commit('确认保存目录关联');
    assert.equal(current().identity.directory, directories[4]);
    assert.equal(current().screenshot, null);
    await seedCovers();
    await openDetails(id);
    await details.getByRole('button', { name: '解除关联' }).click();
    await decideConfirmation(page);
    assert.ok(current().identity);
    await details.getByRole('button', { name: '解除关联' }).click();
    await commit('解除关联');
    assert.equal(current().identity, null);
    assert.equal(current().screenshot, null);
    await seedCovers();

    await card(id).locator('summary').click();
    await card(id).getByRole('button', { name: '删除本机截图' }).click();
    await decideConfirmation(page);
    assert.equal(digest(await readFile(cover(id))), digest(png));
    await card(id).getByRole('button', { name: '删除本机截图' }).click();
    await commit('删除截图');
    assert.equal(current().screenshot, null);
    await seedCovers();
    await card(id).locator('summary').click();
    await card(id).getByRole('button', { name: '从资料库移除' }).click();
    await decideConfirmation(page);
    assert.ok(current());
    assert.equal(digest(await readFile(cover(id))), digest(png));
    await card(id).getByRole('button', { name: '从资料库移除' }).click();
    await commit('移除项目与截图');
    assert.equal(current(), undefined);
    assert.equal(store.state.projects.length, 4);
    await assert.rejects(readFile(cover(id)));

    await page.getByRole('button', { name: '隐私与截图' }).click();
    const settings = page.getByRole('dialog', { name: '你的页面，你做决定。' });
    await settings.getByRole('button', { name: '清空全部截图' }).click();
    await decideConfirmation(page);
    assert.equal(store.state.projects.filter((p) => p.screenshot).length, 4);
    await settings.getByRole('button', { name: '清空全部截图' }).click();
    await commit('删除全部截图');
    assert.equal(store.state.projects.filter((p) => p.screenshot).length, 0);
    assert.equal(store.state.screenshotsEnabled, true);
    await seedCovers();
    await page.getByRole('button', { name: '隐私与截图' }).click();
    const globalPermission = settings.getByRole('checkbox', {
      name: /允许本机截图/,
    });
    await globalPermission.click();
    await decideConfirmation(page);
    assert.equal(await globalPermission.isChecked(), true);
    assert.equal(store.state.projects.filter((p) => p.screenshot).length, 4);
    await globalPermission.click();
    await commit('关闭并删除全部截图');
    assert.equal(store.state.screenshotsEnabled, false);
    assert.equal(store.state.projects.filter((p) => p.screenshot).length, 0);
  },
);

test(
  'validation, storage retry, backup consent, restore and server errors stay inside owned UI',
  { timeout: 90000 },
  async (t) => {
    const ctx = await setup(t);
    const {
      page,
      store,
      root,
      projects,
      ready,
      commit,
      card,
      details,
      openDetails,
      mutations,
    } = ctx;
    const confirmation = page.getByRole('alertdialog');
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    const add = page.getByRole('dialog', { name: '让一个小世界入场。' });
    const before = mutations.length;
    await add.getByRole('textbox').fill('');
    await add.getByRole('button', { name: '添加到项目库' }).click();
    await add.getByRole('alert').waitFor();
    await add.getByRole('textbox').fill('https://example.invalid/private');
    await add.getByRole('button', { name: '添加到项目库' }).click();
    assert.match(await add.getByRole('alert').innerText(), /本机/);
    assert.equal(mutations.length, before);
    await add.getByRole('button', { name: '取消', exact: true }).click();
    const id = projects[0].id;
    await card(id).locator('summary').click();
    await card(id).getByRole('textbox').fill('');
    await card(id).getByRole('button', { name: '保存名称' }).click();
    await card(id).getByRole('alert').waitFor();
    assert.equal(
      store.state.projects.find((p) => p.id === id).name,
      projects[0].name,
    );
    await card(id).locator('summary').click();
    await openDetails(id);
    await details.getByRole('textbox').fill('relative/path');
    await details.getByRole('button', { name: '保存目录关联' }).click();
    assert.match(await details.getByRole('alert').innerText(), /绝对路径/);
    assert.equal(
      await page
        .locator('form')
        .evaluateAll((forms) => forms.every((form) => form.noValidate)),
      true,
    );
    await details.getByRole('button', { name: '完成', exact: true }).click();

    let storageFails = true;
    await page.route('**/api/storage', (route) =>
      storageFails
        ? route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"error":"controlled storage failure"}',
          })
        : route.continue(),
    );
    await ctx.reload();
    await page.getByRole('button', { name: '隐私与截图' }).click();
    const settings = page.getByRole('dialog', { name: '你的页面，你做决定。' });
    await settings
      .getByRole('alert')
      .filter({ hasText: '无法读取截图用量' })
      .waitFor();
    storageFails = false;
    await settings.getByRole('button', { name: '重新读取用量' }).click();
    await settings.getByText('4 张截图 · 0.0 MB', { exact: true }).waitFor();
    await settings
      .getByRole('checkbox', { name: '导出时包含截图', exact: false })
      .check();
    const downloadPromise = page.waitForEvent('download');
    await settings.getByRole('button', { name: '导出本地备份' }).click();
    const download = await downloadPromise;
    const file = path.join(root, 'backup.json.gz');
    await download.saveAs(file);
    const original = structuredClone(store.state);
    const originalImages = await Promise.all(
      store.state.projects
        .filter((p) => p.screenshot)
        .map((p) => readFile(ctx.cover(p.id)).then(digest)),
    );
    await settings.getByLabel('选择 Locade 备份').setInputFiles(file);
    assert.equal(await confirmation.getByRole('checkbox').isChecked(), false);
    await decideConfirmation(page);
    assert.deepEqual(store.state, original);
    await settings.getByLabel('选择 Locade 备份').setInputFiles(file);
    await confirmation.getByRole('checkbox').check();
    await page.keyboard.press('Escape');
    await confirmation.waitFor({ state: 'detached' });
    assert.deepEqual(store.state, original);
    await settings.getByLabel('选择 Locade 备份').setInputFiles(file);
    assert.equal(await confirmation.getByRole('checkbox').isChecked(), false);
    await commit('确认替换并恢复');
    assert.equal(store.state.screenshotsEnabled, false);
    assert.equal(store.state.projects.filter((p) => p.screenshot).length, 0);
    assert.notEqual(store.state.projects[0].id, original.projects[0].id);
    await settings.getByLabel('选择 Locade 备份').setInputFiles(file);
    await confirmation.getByRole('checkbox').check();
    await commit('确认替换并恢复');
    assert.equal(store.state.screenshotsEnabled, true);
    assert.deepEqual(
      await Promise.all(
        store.state.projects
          .filter((p) => p.screenshot)
          .map((p) => readFile(ctx.cover(p.id)).then(digest)),
      ),
      originalImages,
    );

    const restored = structuredClone(store.state);
    const oversizedPath = path.join(root, 'oversized.json.gz');
    const oversized = await open(oversizedPath, 'w');
    await oversized.truncate(48 * 1024 * 1024 + 1);
    await oversized.close();
    await settings.getByLabel('选择 Locade 备份').setInputFiles(oversizedPath);
    await settings
      .getByRole('alert')
      .filter({ hasText: '备份文件超过 48 MB' })
      .waitFor();
    assert.equal(await confirmation.count(), 0);
    assert.deepEqual(store.state, restored);
    await settings.getByLabel('选择 Locade 备份').setInputFiles({
      name: 'invalid.json.gz',
      mimeType: 'application/gzip',
      buffer: Buffer.from('not a backup'),
    });
    await commit('确认替换并恢复');
    await settings
      .getByRole('alert')
      .filter({ hasText: '备份不是有效' })
      .waitFor();
    assert.deepEqual(store.state, restored);
    let releaseBackup;
    const backupHeld = new Promise((resolve) => (releaseBackup = resolve));
    await page.route('**/api/backup', async (route) => {
      await backupHeld;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"受控导出失败，请重试"}',
      });
    });
    await settings.getByRole('button', { name: '导出本地备份' }).click();
    await page.waitForFunction(
      () => document.querySelector('.toolbar-actions .primary').disabled,
    );
    await settings.getByRole('button', { name: '知道了' }).click();
    assert.equal(
      await page
        .getByRole('button', { name: '添加项目', exact: true })
        .isDisabled(),
      true,
    );
    releaseBackup();
    await page.getByRole('alert').filter({ hasText: '受控导出失败' }).waitFor();
    assert.deepEqual(store.state, restored);
    await ready();
  },
);
