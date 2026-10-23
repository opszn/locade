import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/index.js';
import { directoryIdentity } from '../server/identity.js';
import { BROWSER_INSTALL_COMMAND } from '../server/capabilities.js';
import { close, listen } from './helpers.js';
import { forbidNativeDialogs } from './browser-helpers.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64',
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function setup(t, { seeded = false, locale = 'en-US' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-first-use-'));
  let state = 'missing';
  const app = await createApp({
    dataDir: path.join(root, 'data'),
    discoverProjects: async () => ({
      found: [],
      source: 'owned first-use fixture',
    }),
    inspectProject: async () => null,
    screenshotStatus: async () => {
      if (state === 'failure') throw new Error('controlled capability failure');
      return {
        state,
        verifiedLaunch: false,
        installCommand: BROWSER_INSTALL_COMMAND,
      };
    },
  });
  await app.store.transaction(async () => {
    app.store.state.autoRefresh = false;
    app.store.state.screenshotsEnabled = seeded;
    if (seeded)
      for (let index = 0; index < 2; index++) {
        const directory = path.join(root, `project-${index}`);
        await mkdir(directory);
        const project = app.store.upsert({
          title: '秘密项目',
          url: `http://127.0.0.1:${35000 + index}/${randomUUID()}/`,
          identity: await directoryIdentity(directory, 'manual'),
          observation: `owned-${index}`,
        });
        project.screenshot = '2026-10-23T00:00:00.000Z';
        await writeFile(
          path.join(app.store.screenshots, `${project.id}.png`),
          png,
        );
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
    locale,
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(7000);
  const errors = [],
    writes = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      request.url().startsWith(`${base}/api/`) &&
      request.method() !== 'GET' &&
      !request.url().endsWith('/scan')
    )
      writes.push(request.url());
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
  return {
    app,
    root,
    page,
    projects,
    writes,
    base,
    entry,
    reload,
    ready,
    browserState: (value) => {
      state = value;
    },
  };
}

test(
  'first use: browser language, explicit preference, read-only dependency guidance and retry without consent changes',
  { timeout: 30000 },
  async (t) => {
    const { app, page, writes, reload, browserState } = await setup(t);
    await reload();
    await page
      .getByRole('heading', { name: 'Meet your local arcade.' })
      .waitFor();
    await page
      .getByText('Matching browser not installed.', { exact: false })
      .waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.match(await page.title(), /Your localhost arcade/);
    assert.equal(app.store.state.screenshotsEnabled, false);
    assert.deepEqual(writes, []);
    assert.equal(
      await page.locator('.install-command').innerText(),
      BROWSER_INSTALL_COMMAND,
    );
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('blocked');
          },
        },
      }),
    );
    await page.getByRole('button', { name: 'Copy install command' }).click();
    await page.getByText('Clipboard unavailable.', { exact: false }).waitFor();
    browserState('failure');
    await page
      .getByRole('button', { name: 'Check again', exact: true })
      .click();
    await page
      .getByText('Could not confirm browser status.', { exact: false })
      .waitFor();
    browserState('available');
    await page
      .getByRole('button', { name: 'Check again', exact: true })
      .click();
    await page.getByText('Browser files found.', { exact: false }).waitFor();
    await page.getByLabel('Language / 语言').selectOption('zh-CN');
    await page
      .getByRole('heading', { name: '先认识你的本地游乐场。' })
      .waitFor();
    await reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    await page.getByLabel('Language / 语言').selectOption('auto');
    await page
      .getByRole('heading', { name: 'Meet your local arcade.' })
      .waitFor();
    await page.getByRole('button', { name: 'Hide quick start' }).click();
    await reload();
    assert.equal(await page.locator('.getting-started').count(), 0);
    await page
      .getByRole('button', { name: 'Quick start', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Review privacy & screenshots' })
      .click();
    assert.equal(
      await page
        .getByRole('checkbox', { name: 'Allow local screenshots', exact: true })
        .isChecked(),
      false,
    );
    await page.getByRole('button', { name: 'Got it' }).click();
    await mkdir('test-results', { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 640 : 1000 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `English guide fits ${width}px`,
      );
      await page.screenshot({
        path: `test-results/alpha2-guide-${width}.png`,
        fullPage: true,
      });
    }
    assert.equal(app.store.state.projects.length, 0);
    assert.equal(app.store.state.screenshotsEnabled, false);
    assert.deepEqual(writes, []);
  },
);

test(
  'English confirmations cover all ten decisions without translating user data or mutating canceled records',
  { timeout: 60000 },
  async (t) => {
    const { app, page, projects, writes, reload } = await setup(t, {
      seeded: true,
    });
    await reload();
    const project = projects[0],
      card = page.locator(`[data-project-id="${project.id}"]`);
    const cancel = async (heading) => {
      const dialog = page.getByRole('alertdialog');
      await dialog
        .getByRole('heading', { name: heading, exact: true })
        .waitFor();
      const cancelButton = dialog.getByRole('button', {
        name: 'Cancel',
        exact: true,
      });
      assert.equal(
        await cancelButton.evaluate((el) => el === document.activeElement),
        true,
      );
      assert.doesNotMatch(
        await dialog
          .locator('h2, p, button, small')
          .allTextContents()
          .then((a) => a.join(' ')),
        /\p{Script=Han}/u,
      );
      await cancelButton.click();
      await dialog.waitFor({ state: 'detached' });
    };
    await card.locator('.card-menu summary').click();
    await card
      .getByRole('button', { name: 'Delete local screenshot', exact: true })
      .click();
    await cancel('Delete this local screenshot?');
    await card
      .getByRole('button', { name: 'Remove from library', exact: true })
      .click();
    await cancel('Remove this project from the library?');
    await card
      .getByRole('button', { name: 'Directory, addresses & screenshots' })
      .click();
    const details = page.locator('dialog[aria-labelledby="details-title"]');
    await details
      .getByLabel('Application directory (absolute path)')
      .fill('/a-different-owned-placeholder');
    await details
      .getByRole('button', { name: 'Save directory binding', exact: true })
      .click();
    await cancel('Change the directory binding?');
    await details
      .getByRole('button', { name: 'Unbind directory', exact: true })
      .click();
    await cancel('Unbind this directory?');
    await details
      .getByRole('checkbox', {
        name: 'Allow screenshots for this project',
        exact: true,
      })
      .click();
    await cancel('Disable screenshots for this project?');
    await details
      .getByRole('button', { name: 'Ignore project', exact: true })
      .click();
    await cancel('Ignore this project?');
    await details.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Review matching names', exact: true })
      .click();
    const review = page.locator('dialog[aria-labelledby="duplicate-title"]');
    await review
      .getByRole('checkbox', {
        name: `Select for Ignored ${project.id.slice(0, 8)}`,
      })
      .check();
    await review
      .getByRole('button', { name: 'Move to Ignored (1)', exact: true })
      .click();
    await cancel('Move selection to Ignored (1)?');
    assert.equal(
      await review.getByText('秘密项目', { exact: true }).count(),
      2,
    );
    await review.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('button', { name: 'Privacy & screenshots', exact: true })
      .click();
    await page
      .getByRole('checkbox', { name: 'Allow local screenshots', exact: true })
      .click();
    await cancel('Disable screenshots and delete all covers?');
    await page
      .getByRole('button', { name: 'Clear all screenshots', exact: true })
      .click();
    await cancel('Delete all local screenshots?');
    await page.getByLabel('Choose a Locade backup').setInputFiles({
      name: 'metadata.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    });
    const restore = page.getByRole('alertdialog');
    await restore
      .getByRole('heading', { name: 'Replace this library from a backup?' })
      .waitFor();
    assert.equal(
      await restore
        .getByRole('checkbox', { name: /Also restore screenshots/ })
        .isChecked(),
      false,
    );
    await cancel('Replace this library from a backup?');
    await page.getByRole('button', { name: 'Got it' }).click();
    if (await card.locator('.card-menu').evaluate((element) => element.open))
      await card.locator('.card-menu summary').click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 640 : 1000 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `English cards fit ${width}px`,
      );
      await page.screenshot({
        path: `test-results/alpha2-english-${width}.png`,
        fullPage: true,
      });
    }
    assert.deepEqual(writes, []);
    for (const original of projects) {
      const current = app.store.state.projects.find(
        (p) => p.id === original.id,
      );
      for (const key of [
        'name',
        'favorite',
        'hidden',
        'identity',
        'captureAllowed',
        'screenshot',
      ])
        assert.deepEqual(current[key], original[key]);
      assert.equal(
        digest(
          await readFile(
            path.join(app.store.screenshots, `${original.id}.png`),
          ),
        ),
        digest(png),
      );
    }
    const popupReady = page.waitForEvent('popup');
    await card.getByRole('link', { name: 'Open project', exact: true }).click();
    const popup = await popupReady;
    await popup.waitForLoadState();
    await popup
      .getByRole('heading', { name: 'Not opening this one yet.' })
      .waitFor();
    assert.match(
      await popup.getByRole('alert').innerText(),
      /page is unavailable/i,
    );
    assert.equal(await popup.locator('html').getAttribute('lang'), 'en');
    await popup.close();
  },
);

test(
  'blocked preference storage and initial service failure stay recoverable inside the app',
  { timeout: 30000 },
  async (t) => {
    const { page, reload, ready } = await setup(t);
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('storage blocked');
      };
      Storage.prototype.setItem = () => {
        throw new Error('storage blocked');
      };
      Storage.prototype.removeItem = () => {
        throw new Error('storage blocked');
      };
    });
    let unavailable = true;
    await page.route('**/api/library', (route) =>
      unavailable ? route.abort() : route.continue(),
    );
    await reload();
    await page
      .getByRole('button', { name: 'Reconnect to local library' })
      .waitFor();
    assert.equal(await page.locator('.getting-started').count(), 0);
    unavailable = false;
    await page
      .getByRole('button', { name: 'Reconnect to local library' })
      .click();
    await ready();
    await page
      .getByRole('heading', { name: 'Meet your local arcade.' })
      .waitFor();
    await page.getByLabel('Language / 语言').selectOption('zh-CN');
    await page
      .getByRole('heading', { name: '先认识你的本地游乐场。' })
      .waitFor();
    await reload();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  },
);

test(
  'English validation and failed API actions remain owned, retranslate after a language switch and preserve data',
  { timeout: 30000 },
  async (t) => {
    const { app, page, reload } = await setup(t);
    await reload();
    await page
      .getByRole('button', { name: 'Add project', exact: true })
      .click();
    const add = page.locator('dialog[aria-labelledby="add-title"]');
    await add
      .getByRole('textbox', { name: 'Local HTTP(S) address' })
      .fill('https://example.invalid/');
    await add.getByRole('button', { name: 'Add to library' }).click();
    await add
      .getByRole('alert')
      .filter({ hasText: 'Enter a local HTTP(S) address without credentials.' })
      .waitFor();
    await add
      .getByRole('textbox', { name: 'Local HTTP(S) address' })
      .fill('http://127.0.0.1:35000/not-found');
    await add.getByRole('button', { name: 'Add to library' }).click();
    await add
      .getByRole('alert')
      .filter({ hasText: 'No accessible HTML page found.' })
      .waitFor();
    await add.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.route('**/api/backup', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: '备份格式不受支持' }),
      }),
    );
    await page
      .getByRole('button', { name: 'Privacy & screenshots', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Export local backup', exact: true })
      .click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Backup format is not supported' })
      .waitFor();
    await page.getByRole('button', { name: 'Got it' }).click();
    await page.getByLabel('Language / 语言').selectOption('zh-CN');
    await page
      .getByRole('alert')
      .filter({ hasText: '备份格式不受支持' })
      .waitFor();
    assert.equal(app.store.state.projects.length, 0);
    assert.equal(app.store.state.screenshotsEnabled, false);
  },
);
