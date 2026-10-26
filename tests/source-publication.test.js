import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import metadata from '../package.json' with { type: 'json' };
import { APP_VERSION, BUNDLE_VERSION } from '../server/version.js';
import {
  inspectPublicText,
  publicManifest,
  validateLock,
  validateNpmConfig,
} from '../tools/check-source.js';

test('source release metadata, runtime version, bundle version and lock root agree', async () => {
  const lock = JSON.parse(
    await readFile(new URL('../package-lock.json', import.meta.url)),
  );
  const license = await readFile(
    new URL('../LICENSE', import.meta.url),
    'utf8',
  );
  assert.equal(APP_VERSION, metadata.version);
  assert.equal(lock.version, APP_VERSION);
  assert.equal(lock.packages[''].version, APP_VERSION);
  assert.match(BUNDLE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(metadata.license, 'MIT');
  assert.equal(lock.packages[''].license, metadata.license);
  assert.equal(
    metadata.private,
    true,
    'source release must not enable npm publishing',
  );
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Locade contributors/);
});

test('native version is visible and startup failures cannot be overwritten by disconnected refreshes', async () => {
  const native = await readFile(
    new URL('../macos/Locade.swift', import.meta.url),
    'utf8',
  );
  const build = await readFile(
    new URL('../tools/build-macos.js', import.meta.url),
    'utf8',
  );
  assert.match(
    build,
    /<key>LocadeVersion<\/key><string>\$\{APP_VERSION\}<\/string>/,
  );
  assert.match(native, /Text\("App v\\\(model\.appVersion\)/);
  assert.match(native, /serviceVersion = library\.appVersion/);
  assert.match(native, /guard port != nil, !operation else/);
  assert.match(native, /self\.model\.port != nil else/);
  assert.match(native, /output\.contains\("资料库格式不受支持"\)/);
  assert.match(native, /seek\(toOffset: logOffset\)/);
  assert.match(native, /不要删除资料或用旧 JSON 覆盖/);
});

test('English and Chinese READMEs link to each other and keep executable examples in sync', async () => {
  const english = await readFile(
    new URL('../README.md', import.meta.url),
    'utf8',
  );
  const chinese = await readFile(
    new URL('../README.zh-CN.md', import.meta.url),
    'utf8',
  );
  assert.match(english, /\[简体中文\]\(README\.zh-CN\.md\)/);
  assert.match(chinese, /\[English\]\(README\.md\)/);
  const commands = (text) =>
    [...text.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) =>
      match[1]
        .split('\n')
        .map((line) => line.split('#')[0].trim())
        .filter(Boolean),
    );
  assert.ok(commands(english).length > 0);
  assert.deepEqual(commands(english), commands(chinese));
  for (const text of [english, chinese]) {
    assert.ok(text.includes(`v${APP_VERSION}`));
    assert.match(text, /design\/screenshots\/library\.png/);
    assert.match(text, /security\/advisories\/new/);
  }
  assert.match(english, /interface[\s\S]*Simplified Chinese/);
});

test('canonical lock uses public HTTPS tarballs with unchanged SHA512 verification', async () => {
  const lock = JSON.parse(
    await readFile(new URL('../package-lock.json', import.meta.url)),
  );
  assert.ok(validateLock(lock) > 0);
  const dependency = Object.keys(lock.packages).find(Boolean);
  for (const patch of [
    { resolved: 'https://registry.example.invalid/package.tgz' },
    { resolved: 'http://registry.npmjs.org/package.tgz' },
    { resolved: 'https://user@registry.npmjs.org/package.tgz' },
    { integrity: '' },
    { integrity: 'sha512-invalid' },
  ]) {
    const changed = structuredClone(lock);
    Object.assign(changed.packages[dependency], patch);
    assert.throws(() => validateLock(changed));
  }
});

test('project npm config keeps a public default, overridable npmjs host and TLS verification', async () => {
  const config = await readFile(new URL('../.npmrc', import.meta.url), 'utf8');
  validateNpmConfig(config);
  for (const changed of [
    config.replace('strict-ssl=true', 'strict-ssl=false'),
    config.replace('npmjs', 'never'),
    `${config}\n_authToken=example`,
    `${config}\nregistry=https://registry.npmjs.org/`,
  ])
    assert.throws(() => validateNpmConfig(changed));
});

test('public text guard reports categories without echoing personal details or secrets', () => {
  assert.deepEqual(inspectPublicText('/Users/you/Projects/example'), []);
  for (const text of [
    '/Users/' + 'somebody/Projects/private',
    '/home/' + 'somebody/private',
    '-----BEGIN ' + 'PRIVATE KEY-----',
    'ghp_' + 'a'.repeat(36),
    'AKIA' + 'A'.repeat(16),
    'sk-proj-' + 'a'.repeat(40),
  ])
    assert.equal(inspectPublicText(text).length, 1);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-public-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/main.jsx'), 'export default null;');
  await writeFile(path.join(root, '.npmrc'), 'registry=example');
  return root;
}

test('public source selection excludes private evidence and includes reviewed dotfiles and workflows', async (t) => {
  const root = await fixture(t);
  for (const dir of ['test-results', '.build-cache', 'release', '.locade']) {
    await mkdir(path.join(root, dir));
    await writeFile(path.join(root, dir, 'private.json'), 'private data');
  }
  await mkdir(path.join(root, '.github/workflows'), { recursive: true });
  await writeFile(path.join(root, '.github/workflows/ci.yml'), 'name: Checks');
  await writeFile(path.join(root, 'README.zh-CN.md'), 'Chinese project entry');
  const first = await publicManifest(root);
  assert.deepEqual(first, await publicManifest(root));
  assert.deepEqual(
    first.files.map((entry) => entry.file),
    ['.github/workflows/ci.yml', '.npmrc', 'README.zh-CN.md', 'src/main.jsx'],
  );
  await writeFile(path.join(root, 'src/main.jsx'), 'export default 1;');
  assert.notEqual((await publicManifest(root)).sha256, first.sha256);
});

test('public source selection fails closed on unreviewed roots, symlinks, nested secrets and personal paths', async (t) => {
  const root = await fixture(t);
  const suspect = path.join(root, 'private-notes.md');
  await writeFile(suspect, 'not reviewed');
  await assert.rejects(publicManifest(root), /根目录/);
  await rm(suspect);
  const link = path.join(root, 'src/external.js');
  await symlink(path.join(root, '.npmrc'), link);
  await assert.rejects(publicManifest(root), /链接/);
  await rm(link);
  const env = path.join(root, 'src/.env.json');
  await writeFile(env, '{}');
  await assert.rejects(publicManifest(root), /文件类型/);
  await rm(env);
  await writeFile(
    path.join(root, 'src/private.md'),
    '/Users/' + 'somebody/private',
  );
  await assert.rejects(publicManifest(root), /需脱敏/);
});

test('internal agent instructions are rejected at the root and inside allowed source directories', async (t) => {
  const root = await fixture(t);
  for (const file of [
    'AGENTS.md',
    'src/AGENTS.md',
    'src/agents.override.md',
    'src/CLAUDE.md',
    'src/GEMINI.md',
    '.github/copilot-instructions.md',
  ]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'internal instructions');
    await assert.rejects(publicManifest(root), /内部代理指令/);
    await rm(path.join(root, file));
  }
});
