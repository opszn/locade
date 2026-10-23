import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSync } from 'rolldown/utils';
import {
  messages,
  normalizeLanguage,
  resolveLocale,
  createTranslator,
  translateMessage,
  translateDiagnostic,
} from '../server/i18n.js';
import {
  screenshotCapability,
  BROWSER_INSTALL_COMMAND,
} from '../server/capabilities.js';
import { createApp } from '../server/index.js';
import { sendNavigationError } from '../server/navigation-error.js';
import { close, listen } from './helpers.js';

test('language selection uses a supported explicit preference, then browser order, with a safe default', () => {
  assert.equal(resolveLocale('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(resolveLocale('en', ['zh-CN']), 'en');
  assert.equal(resolveLocale('auto', ['fr-FR', 'zh-TW', 'en-US']), 'zh-CN');
  assert.equal(resolveLocale('auto', ['en-GB', 'zh-CN']), 'en');
  assert.equal(resolveLocale('untrusted', ['fr']), 'en');
  assert.equal(normalizeLanguage('<img src=x>'), null);
  assert.equal(normalizeLanguage(['en']), null);
});

test('catalog preserves placeholders and user values, including when retranslating an existing notice', () => {
  const slots = (text) =>
    [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
  for (const [key, english] of Object.entries(messages)) {
    assert.ok(english.trim(), key);
    assert.deepEqual(slots(key), slots(english), key);
    assert.doesNotMatch(english, /\p{Script=Han}/u, key);
  }
  const original = '秘密项目 / 收藏 <script>user</script> {0}';
  const english = createTranslator('en');
  assert.equal(
    english('{0} 的本机页面截图', [original]),
    `Local page screenshot for ${original}`,
  );
  const notice = english('已撤销本次整理，恢复 {0} 项。', [3]);
  assert.equal(
    translateMessage(notice, 'zh-CN'),
    '已撤销本次整理，恢复 3 项。',
  );
  assert.equal(translateMessage('外部未知诊断', 'en'), '外部未知诊断');
  assert.match(
    translateDiagnostic('网页探测超时；地址已被其他项目复用', 'en'),
    /timed out; Address reused/,
  );
});

test('UI message keys all have English translations and no raw Chinese JSX content is left', async () => {
  const root = new URL('../src/', import.meta.url);
  let keys = 0;
  for (const file of (await readdir(root)).filter((name) =>
    name.endsWith('.jsx'),
  )) {
    const source = await readFile(new URL(file, root), 'utf8');
    const parsed = parseSync(file, source);
    assert.deepEqual(parsed.errors, [], file);
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'JSXText' && node.value.trim() !== '简体中文')
        assert.doesNotMatch(node.value, /\p{Script=Han}/u, file);
      if (
        node.type === 'CallExpression' &&
        node.callee.name === 't' &&
        node.arguments[0]?.type === 'Literal'
      ) {
        const key = node.arguments[0].value;
        assert.ok(Object.hasOwn(messages, key), `${file}: ${key}`);
        keys++;
      }
      for (const value of Object.values(node)) {
        for (const child of Array.isArray(value) ? value : [value])
          if (child?.type) visit(child);
      }
    }
    visit(parsed.program);
  }
  assert.ok(keys > 250);
});

test('browser readiness is a read-only executable-file check, never a launch or install', async () => {
  let pathChecked;
  const installed = await screenshotCapability({
    executable: '/owned/browser',
    check: async (file) => {
      pathChecked = file;
    },
  });
  assert.equal(pathChecked, '/owned/browser');
  assert.deepEqual(installed, {
    state: 'available',
    verifiedLaunch: false,
    installCommand: BROWSER_INSTALL_COMMAND,
  });
  for (const [code, state] of [
    ['ENOENT', 'missing'],
    ['EACCES', 'unknown'],
    ['EIO', 'unknown'],
  ]) {
    assert.equal(
      (
        await screenshotCapability({
          executable: '/private/not-echoed',
          check: async () => {
            throw Object.assign(new Error('private error'), { code });
          },
        })
      ).state,
      state,
    );
  }
});

test('API localizes known failures per request without changing stored data or weakening request guards', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'locade-locale-api-'));
  const app = await createApp({
    dataDir,
    screenshotStatus: async () => ({
      state: 'missing',
      verifiedLaunch: false,
      installCommand: BROWSER_INSTALL_COMMAND,
    }),
  });
  t.after(async () => {
    await close(app.server);
    await app.release();
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = await listen(app.server);
  await app.store.transaction(async () => {});
  const bytes = await readFile(path.join(dataDir, 'library.json'));
  const english = await fetch(`${base}/api/settings`, {
    method: 'PATCH',
    headers: { 'X-Locade-Language': 'en' },
    body: '{}',
  });
  assert.equal(english.status, 403);
  assert.match((await english.json()).error, /Session expired/);
  const chinese = await fetch(`${base}/api/settings`, {
    method: 'PATCH',
    body: '{}',
  });
  assert.match((await chinese.json()).error, /会话已过期/);
  const cap = await (await fetch(`${base}/api/capabilities`)).json();
  assert.equal(cap.screenshots.state, 'missing');
  assert.equal(cap.screenshots.installCommand, BROWSER_INSTALL_COMMAND);
  assert.deepEqual(await readFile(path.join(dataDir, 'library.json')), bytes);
  assert.equal(
    (
      await fetch(`${base}/api/capabilities`, {
        headers: { Origin: 'https://example.invalid' },
      })
    ).status,
    403,
  );
});

test('English navigation failure keeps owned feedback and escapes untrusted content and locale input', () => {
  let html;
  const response = {
    writeHead() {},
    end(value) {
      html = value;
    },
  };
  sendNavigationError(response, '<img onerror="secret">', 'en');
  assert.match(html, /lang="en"/);
  assert.match(html, /Cannot open project/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img onerror/);
  sendNavigationError(response, '网页当前不可用，请重新发现', 'en');
  assert.match(html, /The page is unavailable/);
});
