import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  chmod,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { forbidNativeDialogs } from './browser-helpers.js';
import { createApp } from '../server/index.js';
import { probe } from '../server/network.js';
import { directoryIdentity, refreshIdentity } from '../server/identity.js';
import { urlKey } from '../server/store.js';
import { close, listen } from './helpers.js';

const output = path.resolve('test-results');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function startFixture(project, port = 0, hostname = '127.0.0.1') {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url, agent: request.headers['user-agent'] });
    if (request.url !== project.route) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not a project entry point');
      return;
    }
    if (
      project.failCapture &&
      request.headers['user-agent']?.includes('HeadlessChrome')
    ) {
      response.writeHead(302, { Location: '/capture-redirect' });
      response.end();
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><html><head><title>${project.name}</title><style>
      *{box-sizing:border-box}body{margin:0;padding:64px;background:${project.color};color:#232722;font-family:Georgia,serif;min-height:100vh}nav{font:14px monospace;letter-spacing:3px;border-bottom:1px solid #23272266;padding-bottom:24px}h1{font-size:112px;max-width:1000px;font-weight:400;letter-spacing:-6px;line-height:1.05;margin:105px 0 36px}p{font-size:24px;max-width:800px}.orb{position:absolute;width:190px;height:190px;border:30px solid #23272222;border-radius:50%;right:80px;top:110px}
      </style></head><body><nav>LOCADE / CONTROLLED FIVE-PROJECT FIXTURE</nav><div class="orb"></div><h1>${project.name}</h1><p>${project.caption}</p><p>This page and its directory are temporary test data.</p></body></html>`);
  });
  const listening = once(server, 'listening');
  server.listen(port, '127.0.0.1');
  await listening;
  const url = `http://${hostname}:${server.address().port}${project.route}`;
  const service = { server, url, requests, project };
  project.service = service;
  return service;
}

test(
  'five-project visual retrieval: retained covers, source intent, moved and reused ports, missing directory and failed capture',
  { timeout: 120000 },
  async (t) => {
    await mkdir(output, { recursive: true });
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'locade-five-projects-')),
    );
    const fixtureRoute = `/__locade-five-${randomUUID()}/`;
    const services = [];
    const openIntents = [];
    const checks = [];
    const report = {
      startedAt: new Date().toISOString(),
      fixtureCount: 5,
      scenario: 'controlled same-session retrieval, not a real user study',
      scopeIsNotPassEvidence: true,
      checks,
      safety: {
        loopbackOnly: true,
        discoveryInjected: true,
        processMetadataInjected: true,
        realGitCommands: false,
        userProjectsRead: false,
        projectScriptsRun: false,
        actualIdeLaunched: false,
        browserCopied: false,
      },
      realCoverage: [
        'Chromium project library navigation and local project popups',
        'five temporary project directories and read-only Git HEAD metadata',
        'four real local PNG covers and on-disk SHA256 retention checks',
        'controlled local server shutdown, port move and equivalent-host port reuse',
        'missing temporary directory and browser-specific redirect capture failure',
        'desktop and 390px/320px layout overflow checks',
      ],
      intentOnly: [
        'Finder, VS Code and Cursor opening use an injected recorder; no native app is opened',
        'application-unavailable error is injected; it does not test real editor installation',
      ],
      notCovered: [
        'real process scanning or user project metadata discovery',
        'native menu-bar GUI and launch-at-login',
        'one-week retention, user retrieval speed or competitor efficiency',
      ],
      screenshots: [],
    };
    let browser;
    let app;
    let completed = false;
    t.after(async () => {
      const cleanupErrors = [];
      const clean = async (name, action) => {
        try {
          await action();
        } catch (error) {
          cleanupErrors.push({ name, error: error.message });
        }
      };
      await clean('browser', () => browser?.close());
      if (app) {
        await clean('application', () => close(app.server));
        await clean('instance lock', () => app.release());
      }
      for (const service of services)
        await clean('fixture server', () => close(service.server));
      await clean('temporary data', () =>
        rm(root, { recursive: true, force: true }),
      );
      report.finishedAt = new Date().toISOString();
      report.completedCheckCount = checks.length;
      report.passedCheckCount = checks.filter((check) => check.passed).length;
      report.overall = completed && !cleanupErrors.length ? 'passed' : 'failed';
      report.openIntents = openIntents.map(({ editor, outcome, project }) => ({
        editor,
        outcome,
        project,
      }));
      report.cleanupErrors = cleanupErrors;
      await writeFile(
        path.join(output, 'five-projects.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      assert.deepEqual(
        cleanupErrors,
        [],
        'all test-owned resources are removed',
      );
    });
    const verify = async (name, operation) => {
      const started = performance.now();
      try {
        await operation();
        checks.push({
          name,
          passed: true,
          durationMs: Math.round(performance.now() - started),
        });
      } catch (error) {
        checks.push({
          name,
          passed: false,
          durationMs: Math.round(performance.now() - started),
          error: error.message,
        });
        throw error;
      }
    };
    const definitions = [
      ['Sprout Studio', '01 sprout-studio', 'fixture/sprout', '#e2ead7'],
      ['Field Notes', '02 field-notes', 'fixture/notes', '#ecd9bf'],
      ['Orange Arcade', '03 orange-arcade', 'fixture/arcade', '#f3b07f'],
      ['Carbon Board', '04 carbon-board', 'fixture/carbon', '#c6d8e0'],
      ['Paper Atlas', '05 paper-atlas', 'fixture/atlas', '#e8dfb9'],
    ];
    const projects = [];
    for (const [name, folder, branch, color] of definitions) {
      const directory = path.join(root, 'projects', folder);
      await mkdir(path.join(directory, '.git'), { recursive: true });
      await writeFile(
        path.join(directory, 'package.json'),
        `${JSON.stringify({ name: folder.slice(3), private: true })}\n`,
      );
      const head = path.join(directory, '.git', 'HEAD');
      await writeFile(head, `ref: refs/heads/${branch}\n`);
      await chmod(head, 0o444);
      const project = {
        name,
        branch,
        color,
        caption: `A distinctive local cover for ${name}.`,
        directory,
        route: fixtureRoute,
        identity: await directoryIdentity(directory, 'auto'),
        failCapture: false,
      };
      projects.push(project);
      services.push(
        await startFixture(
          project,
          0,
          name === 'Carbon Board' ? 'localhost' : '127.0.0.1',
        ),
      );
    }
    const [sprout, notes, arcade, carbon, atlas] = projects;
    const initialCarbonUrl = carbon.service.url;
    const initialArcadeUrl = arcade.service.url;
    const activeServices = () =>
      services.filter((service) => service.server.listening);
    const inspect = async (url, onFailure) => {
      const service = activeServices().find(
        (candidate) => urlKey(candidate.url) === urlKey(url),
      );
      if (!service) {
        onFailure?.({ status: 'offline', reason: '受控项目服务已关闭' });
        return null;
      }
      const found = await probe(url, 1200, onFailure);
      return found
        ? {
            ...found,
            identity: await refreshIdentity(service.project.identity),
            observation: `fixture:${projects.indexOf(service.project)}:${new URL(service.url).port}`,
          }
        : null;
    };
    let discoveryCalls = 0;
    app = await createApp({
      dataDir: path.join(root, 'library'),
      discoverProjects: async (_port, knownUrls) => {
        discoveryCalls++;
        const checked = [];
        const urls = [
          ...new Set([
            ...activeServices().map((service) => service.url),
            ...knownUrls.filter(
              (url) =>
                !activeServices().some(
                  (service) => urlKey(service.url) === urlKey(url),
                ),
            ),
          ]),
        ];
        const found = await Promise.all(
          urls.map((url) =>
            inspect(url, (failure) => checked.push({ url, ...failure })),
          ),
        );
        return {
          found: found.filter(Boolean),
          checked,
          source: 'five isolated fixture projects; no process scan',
        };
      },
      inspectProject: inspect,
      openProjectDirectory: async (directory, editor) => {
        const project = projects.find((item) => item.directory === directory);
        assert.ok(project, 'only fixture directories can be opened');
        await directoryIdentity(directory);
        if (editor === 'cursor') {
          openIntents.push({
            directory,
            editor,
            project: project.name,
            outcome: 'failed',
          });
          throw new Error('无法打开所选应用，请确认已安装；也可改用 Finder');
        }
        openIntents.push({
          directory,
          editor,
          project: project.name,
          outcome: 'recorded',
        });
      },
    });
    const base = await listen(app.server);
    const executablePath = process.env.LOCADE_BROWSER_EXECUTABLE || undefined;
    report.browserExecutable = executablePath || chromium.executablePath();
    browser = await chromium.launch({ headless: true, executablePath });
    const context = await browser.newContext({
      locale: 'zh-CN',
      viewport: { width: 1440, height: 1100 },
      reducedMotion: 'reduce',
    });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (['127.0.0.1', 'localhost'].includes(url.hostname))
        return route.continue();
      await route.abort();
    });
    const page = await context.newPage();
    forbidNativeDialogs(page, t);
    page.setDefaultTimeout(10000);
    const runtimeErrors = [];
    const apiErrors = [];
    const openedRequests = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    context.on('request', (request) => {
      if (
        /\/api\/projects\/[^/]+\/opened$|\/open\/[a-f0-9-]{36}$/.test(
          request.url(),
        )
      )
        openedRequests.push(request.url());
    });
    page.on('response', (response) => {
      if (response.url().startsWith(`${base}/api/`) && response.status() >= 400)
        apiErrors.push({ url: response.url(), status: response.status() });
    });
    const card = (project) =>
      page.locator(`.project-card[data-project-id="${project.id}"]`);
    const library = async () => {
      const response = await page.request.get(`${base}/api/library`);
      assert.equal(response.status(), 200);
      return response.json();
    };
    const ready = () =>
      page
        .locator('button:not([disabled])')
        .filter({ hasText: /^重新发现$/ })
        .waitFor();
    const responseFor = (pathname, method) =>
      page.waitForResponse(
        (response) =>
          response.url() === `${base}/api/${pathname}` &&
          response.request().method() === method,
      );
    const perform = async (pathname, method, action, status = 200) => {
      const done = responseFor(pathname, method);
      await action();
      const response = await done;
      assert.equal(response.status(), status);
      await ready();
      return response;
    };
    const scan = () =>
      perform('scan', 'POST', () =>
        page.getByRole('button', { name: '重新发现', exact: true }).click(),
      );
    const screenshot = async (filename) => {
      await page.screenshot({
        path: path.join(output, filename),
        fullPage: true,
      });
      report.screenshots.push(`test-results/${filename}`);
    };
    const waitForDetails = async (project) => {
      const details = page.getByRole('dialog', {
        name: project.name,
        exact: true,
      });
      await details.waitFor();
      // React resets the controlled directory field in an effect after the heading changes.
      await page.waitForFunction(
        ({ name, directory }) => {
          const dialog = document.querySelector(
            'dialog[open][aria-labelledby="details-title"]',
          );
          return (
            dialog?.querySelector('#details-title')?.textContent === name &&
            dialog?.querySelector('#directory')?.value === directory
          );
        },
        { name: project.name, directory: project.directory },
      );
      return details;
    };
    const openDetails = async (project) => {
      await card(project)
        .getByRole('button', {
          name: `${project.name} 的目录与详情`,
          exact: true,
        })
        .click();
      return waitForDetails(project);
    };
    const returnToSource = async (project, editor) => {
      const details = await openDetails(project);
      await details
        .getByRole('combobox', { name: '回到开发现场' })
        .selectOption(editor);
      await perform(`projects/${project.id}/open-directory`, 'POST', () =>
        details.getByRole('button', { name: '打开所选应用' }).click(),
      );
      assert.deepEqual(openIntents.at(-1), {
        directory: project.directory,
        editor,
        project: project.name,
        outcome: 'recorded',
      });
      await details.getByRole('button', { name: '完成', exact: true }).click();
    };
    const screenshotBytes = (project) =>
      readFile(
        app.store.screenshotPath(
          app.store.state.projects.find((p) => p.id === project.id),
        ),
      );
    const assertSafeReuseButton = async (project, service) => {
      const button = card(project).getByRole('button', {
        name: '地址已被复用',
        exact: true,
      });
      assert.equal(
        await button.evaluate((element) => element.tagName),
        'BUTTON',
      );
      assert.equal(await button.getAttribute('href'), null);
      assert.equal(await button.getAttribute('aria-disabled'), null);
      assert.equal(await card(project).locator('a.open-link').count(), 0);
      const pagesBefore = context.pages().length;
      const openedBefore = openedRequests.length;
      const requestsBefore = service.requests.length;
      const popupAttempt = page.waitForEvent('popup', { timeout: 250 }).then(
        () => true,
        (error) => {
          if (error.name !== 'TimeoutError') throw error;
          return false;
        },
      );
      await button.click({ button: 'middle' });
      assert.equal(
        await popupAttempt,
        false,
        'middle click cannot open a reused address',
      );
      assert.equal(context.pages().length, pagesBefore);
      assert.equal(openedRequests.length, openedBefore);
      assert.equal(service.requests.length, requestsBefore);
      return button;
    };

    await verify(
      'discover exactly five projects with controlled Git metadata and capture consent',
      async () => {
        const initialScan = responseFor('scan', 'POST');
        await page.goto(base);
        assert.equal((await initialScan).status(), 200);
        await ready();
        assert.equal(await page.locator('.project-card').count(), 5);
        const initial = await library();
        assert.equal(initial.projects.length, 5);
        assert.equal(initial.screenshotsEnabled, false);
        assert.equal(await page.locator('.screenshot').count(), 0);
        for (const project of projects) {
          const stored = initial.projects.find(
            (item) => item.name === project.name,
          );
          assert.ok(stored);
          project.id = stored.id;
          assert.equal(stored.identity.directory, project.directory);
          assert.equal(stored.identity.branch, project.branch);
          assert.equal(
            await card(project)
              .getByRole('button', { name: '生成截图' })
              .isDisabled(),
            true,
          );
        }
        await page.getByRole('button', { name: '隐私与截图' }).click();
        const settings = page.getByRole('dialog', {
          name: '你的页面，你做决定。',
        });
        await perform('settings', 'PATCH', () =>
          settings
            .getByRole('checkbox', { name: '前台自动发现', exact: true })
            .uncheck(),
        );
        await perform('settings', 'PATCH', () =>
          settings.getByRole('checkbox', { name: /允许本机截图/ }).check(),
        );
        await settings.getByRole('button', { name: '知道了' }).click();
        for (const project of [notes, arcade, carbon, atlas]) {
          await perform(`projects/${project.id}/screenshot`, 'POST', () =>
            card(project)
              .getByRole('button', { name: '生成截图', exact: true })
              .click(),
          );
          await card(project).locator('.screenshot').waitFor();
          await page.waitForFunction(
            (id) =>
              document.querySelector(`[data-project-id="${id}"] .screenshot`)
                ?.naturalWidth === 1440,
            project.id,
          );
          const bytes = await screenshotBytes(project);
          assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
          project.coverSha256 = sha256(bytes);
          project.coverVersion = (await library()).projects.find(
            (item) => item.id === project.id,
          ).screenshot;
        }
        assert.equal(await card(sprout).locator('.screenshot').count(), 0);
        await screenshot('five-projects-online-desktop.png');
      },
    );

    await verify(
      'search by title, directory and Git branch, then open a real running page',
      async () => {
        const search = page.getByRole('textbox', { name: '搜索项目' });
        for (const [query, project] of [
          ['Orange Arcade', arcade],
          ['02 field-notes', notes],
          ['fixture/carbon', carbon],
        ]) {
          await search.fill(query);
          await card(project).waitFor();
          assert.equal(await page.locator('.project-card').count(), 1);
        }
        await search.fill('not-a-fixture-project');
        await page.getByRole('heading', { name: '还没有匹配的项目' }).waitFor();
        await search.fill('');
        const opened = context.waitForEvent('response', {
          predicate: (response) =>
            response.url() === `${base}/open/${sprout.id}?lang=zh-CN`,
        });
        const popupReady = page.waitForEvent('popup');
        await card(sprout)
          .getByRole('link', { name: '打开项目', exact: true })
          .click();
        const popup = await popupReady;
        await popup.waitForLoadState();
        assert.equal(await popup.title(), sprout.name);
        assert.equal((await opened).status(), 302);
        await popup.close();
        await ready();
        assert.ok(
          (await library()).projects.find((item) => item.id === sprout.id)
            .lastOpened,
        );
      },
    );

    await verify(
      'failed real browser capture displays an error and retains previous cover bytes',
      async () => {
        notes.failCapture = true;
        const response = await perform(
          `projects/${notes.id}/screenshot`,
          'POST',
          () =>
            card(notes)
              .getByRole('button', { name: '更新截图', exact: true })
              .click(),
          400,
        );
        assert.match((await response.json()).error, /截图失败/);
        await page
          .getByRole('alert')
          .filter({ hasText: /截图失败/ })
          .waitFor();
        assert.equal(sha256(await screenshotBytes(notes)), notes.coverSha256);
        assert.equal(
          (await library()).projects.find((item) => item.id === notes.id)
            .screenshot,
          notes.coverVersion,
        );
        assert.equal(await card(notes).locator('.screenshot').count(), 1);
        assert.equal(
          (await readdir(path.join(root, 'library', 'screenshots'))).some(
            (name) => name.endsWith('.tmp'),
          ),
          false,
        );
        notes.failCapture = false;
        await screenshot('five-projects-capture-failure.png');
      },
    );

    await verify(
      'offline project retains its screenshot and returns to the exact directory by Finder intent',
      async () => {
        await close(notes.service.server);
        await scan();
        const stored = (await library()).projects.find(
          (item) => item.id === notes.id,
        );
        assert.equal(stored.online, false);
        assert.equal(stored.status, 'offline');
        assert.equal(stored.identity.directory, notes.directory);
        await card(notes).getByText('离线保留', { exact: true }).waitFor();
        assert.equal(
          await card(notes)
            .getByRole('button', { name: '更新截图', exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(sha256(await screenshotBytes(notes)), notes.coverSha256);
        await returnToSource(notes, 'finder');
      },
    );

    await verify(
      'port move retains one project, favorite, screenshot and source editor identity',
      async () => {
        await perform(`projects/${arcade.id}`, 'PATCH', () =>
          card(arcade)
            .getByRole('button', { name: `收藏 ${arcade.name}`, exact: true })
            .click(),
        );
        await close(arcade.service.server);
        const moved = await startFixture(arcade);
        services.push(moved);
        assert.notEqual(moved.url, initialArcadeUrl);
        await scan();
        const current = await library();
        assert.equal(current.projects.length, 5);
        assert.equal(
          current.projects.filter(
            (item) => item.identity.key === arcade.identity.key,
          ).length,
          1,
        );
        const stored = current.projects.find((item) => item.id === arcade.id);
        assert.equal(stored.url, moved.url);
        assert.equal(stored.favorite, true);
        assert.equal(stored.screenshot, arcade.coverVersion);
        assert.equal(sha256(await screenshotBytes(arcade)), arcade.coverSha256);
        assert.ok(
          stored.endpoints.some(
            (endpoint) => endpoint.url === initialArcadeUrl && !endpoint.online,
          ),
        );
        assert.ok(
          stored.endpoints.some(
            (endpoint) => endpoint.url === moved.url && endpoint.online,
          ),
        );
        await returnToSource(arcade, 'vscode');
      },
    );

    await verify(
      'equivalent-host reused port cannot inherit or open an offline project cover',
      async () => {
        const reusedPort = Number(new URL(initialCarbonUrl).port);
        await close(carbon.service.server);
        await close(sprout.service.server);
        const reused = await startFixture(sprout, reusedPort);
        services.push(reused);
        assert.equal(new URL(initialCarbonUrl).hostname, 'localhost');
        assert.equal(new URL(reused.url).hostname, '127.0.0.1');
        assert.equal(urlKey(initialCarbonUrl), urlKey(reused.url));
        await scan();
        const current = await library();
        assert.equal(current.projects.length, 5);
        const original = current.projects.find((item) => item.id === carbon.id);
        const replacement = current.projects.find(
          (item) => item.id === sprout.id,
        );
        assert.equal(original.online, false);
        assert.equal(original.addressReused, true);
        assert.equal(original.identity.directory, carbon.directory);
        assert.equal(original.screenshot, carbon.coverVersion);
        assert.equal(sha256(await screenshotBytes(carbon)), carbon.coverSha256);
        assert.equal(replacement.url, reused.url);
        assert.equal(replacement.identity.directory, sprout.directory);
        assert.equal(replacement.screenshot, null);
        assert.equal(await card(sprout).locator('.screenshot').count(), 0);
        const reuseButton = await assertSafeReuseButton(carbon, reused);
        const pagesBefore = context.pages().length;
        const openedBefore = openedRequests.length;
        const requestsBefore = reused.requests.length;
        await reuseButton.click();
        const details = await waitForDetails(carbon);
        assert.equal(context.pages().length, pagesBefore);
        assert.equal(openedRequests.length, openedBefore);
        assert.equal(reused.requests.length, requestsBefore);
        assert.equal(
          (await library()).projects.find((item) => item.id === carbon.id)
            .lastOpened,
          null,
        );
        assert.equal(
          await details
            .getByRole('textbox', { name: '应用目录（绝对路径）' })
            .inputValue(),
          carbon.directory,
        );
        await screenshot('five-projects-reused-address-desktop.png');
        await details
          .getByRole('button', { name: '完成', exact: true })
          .click();
        await returnToSource(carbon, 'finder');
      },
    );

    await verify(
      'manual addition invalidates a stale old owner without a discovery scan',
      async () => {
        const atlasPort = Number(new URL(atlas.service.url).port);
        assert.equal(
          (await library()).projects.find((item) => item.id === atlas.id)
            .online,
          true,
        );
        await close(atlas.service.server);
        const manuallyAdded = await startFixture(notes, atlasPort, 'localhost');
        services.push(manuallyAdded);
        const scansBefore = discoveryCalls;
        await page
          .getByRole('button', { name: '添加项目', exact: true })
          .click();
        await page
          .getByRole('textbox', { name: '本地 HTTP(S) 地址' })
          .fill(manuallyAdded.url);
        await perform('projects', 'POST', () =>
          page
            .getByRole('button', { name: '添加到项目库', exact: true })
            .click(),
        );
        assert.equal(
          discoveryCalls,
          scansBefore,
          'manual add, not a background scan, detects the replacement',
        );
        const current = await library();
        assert.equal(current.projects.length, 5);
        const original = current.projects.find((item) => item.id === atlas.id);
        const replacement = current.projects.find(
          (item) => item.id === notes.id,
        );
        assert.equal(original.online, false);
        assert.equal(original.addressReused, true);
        assert.equal(original.screenshot, atlas.coverVersion);
        assert.equal(sha256(await screenshotBytes(atlas)), atlas.coverSha256);
        assert.equal(replacement.online, true);
        assert.equal(replacement.url, manuallyAdded.url);
        assert.equal(replacement.identity.directory, notes.directory);
        assert.equal(replacement.screenshot, notes.coverVersion);
        assert.equal(sha256(await screenshotBytes(notes)), notes.coverSha256);
        await assertSafeReuseButton(atlas, manuallyAdded);
        await screenshot('five-projects-manual-reuse-desktop.png');
      },
    );

    await verify(
      'missing directory is explicit and cannot issue editor intents',
      async () => {
        await rm(atlas.directory, { recursive: true, force: true });
        await scan();
        const stored = (await library()).projects.find(
          (item) => item.id === atlas.id,
        );
        assert.equal(stored.online, false);
        assert.equal(stored.identity.available, false);
        assert.equal(stored.identity.directory, atlas.directory);
        assert.equal(sha256(await screenshotBytes(atlas)), atlas.coverSha256);
        await card(atlas)
          .getByText(/目录不可用/)
          .waitFor();
        const intentsBefore = openIntents.length;
        const details = await openDetails(atlas);
        await details
          .getByText('目录不存在或无权读取', { exact: true })
          .waitFor();
        assert.equal(
          await details
            .getByRole('button', { name: '打开所选应用' })
            .isDisabled(),
          true,
        );
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await screenshot('five-projects-missing-directory-mobile.png');
        assert.equal(openIntents.length, intentsBefore);
        await details
          .getByRole('button', { name: '完成', exact: true })
          .click();
        await page.setViewportSize({ width: 1440, height: 1100 });
      },
    );

    await verify(
      'unavailable editor error remains recoverable through Finder without native application launch',
      async () => {
        const details = await openDetails(sprout);
        await details
          .getByRole('combobox', { name: '回到开发现场' })
          .selectOption('cursor');
        await perform(
          `projects/${sprout.id}/open-directory`,
          'POST',
          () => details.getByRole('button', { name: '打开所选应用' }).click(),
          400,
        );
        await page
          .getByRole('alert')
          .filter({ hasText: /无法打开所选应用/ })
          .waitFor();
        assert.equal(openIntents.at(-1).editor, 'cursor');
        assert.equal(openIntents.at(-1).outcome, 'failed');
        await details
          .getByRole('combobox', { name: '回到开发现场' })
          .selectOption('finder');
        await perform(`projects/${sprout.id}/open-directory`, 'POST', () =>
          details.getByRole('button', { name: '打开所选应用' }).click(),
        );
        assert.equal(openIntents.at(-1).directory, sprout.directory);
        assert.equal(openIntents.at(-1).editor, 'finder');
        assert.equal(openIntents.at(-1).outcome, 'recorded');
        await details
          .getByRole('button', { name: '完成', exact: true })
          .click();
        assert.equal(await page.getByRole('alert').count(), 0);
      },
    );

    await verify(
      'all five cards remain searchable and intact on desktop and narrow mobile viewports',
      async () => {
        assert.equal(await page.locator('.project-card').count(), 5);
        await screenshot('five-projects-retrieval-desktop.png');
        for (const width of [390, 320]) {
          await page.setViewportSize({ width, height: 844 });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `no overflow at ${width}px`,
          );
          if (width === 390)
            await screenshot('five-projects-retrieval-mobile.png');
        }
        assert.deepEqual(runtimeErrors, []);
        assert.equal(
          apiErrors.length,
          2,
          'only the two deliberate API failures occur',
        );
        assert.ok(apiErrors.every((failure) => failure.status === 400));
        report.apiErrors = apiErrors.map(({ url, status }) => ({
          endpoint: new URL(url).pathname,
          status,
        }));
        report.projectResults = (await library()).projects.map((project) => ({
          name: project.name,
          online: project.online,
          hasCover: !!project.screenshot,
          addressReused: !!project.addressReused,
          directoryAvailable: project.identity?.available !== false,
          endpointCount: project.endpoints.length,
        }));
      },
    );
    completed = true;
  },
);
