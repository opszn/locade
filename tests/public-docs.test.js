import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { APP_VERSION } from '../server/version.js';
import { messages } from '../server/i18n.js';

const PUBLISHED_VERSION = '0.3.0-alpha.1';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const read = (file) => readFile(path.join(root, file), 'utf8');
const pairs = [
  ['README.md', 'README.zh-CN.md'],
  ['docs/QUICK_START.md', 'docs/QUICK_START.zh-CN.md'],
  ['docs/RELEASE_NOTES.en.md', 'docs/RELEASE_NOTES.md'],
  ['docs/ALPHA2_RELEASE_NOTES.en.md', 'docs/ALPHA2_RELEASE_NOTES.md'],
];
const commands = (text) =>
  [...text.matchAll(/```sh\n([\s\S]*?)```/g)].map((match) =>
    match[1]
      .split('\n')
      .map((line) => line.split('#')[0].trim())
      .filter(Boolean),
  );

test('paired public guides and release notes have matching shell examples and reciprocal language links', async () => {
  for (const [english, chinese] of pairs) {
    const en = await read(english);
    const zh = await read(chinese);
    assert.ok(en.includes(`](${path.basename(chinese)})`), english);
    assert.ok(zh.includes(`](${path.basename(english)})`), chinese);
    assert.deepEqual(commands(en), commands(zh), english);
    for (const text of [en, zh])
      assert.ok(text.includes(`v${PUBLISHED_VERSION}`), english);
  }
});

test('quick start pins the published source and separates optional browser installation from npm registry choice', async () => {
  const english = await read('docs/QUICK_START.md');
  const chinese = await read('docs/QUICK_START.zh-CN.md');
  for (const text of [english, chinese]) {
    const shell = commands(text).flat().join('\n');
    assert.ok(
      shell.includes(
        `git clone --branch v${PUBLISHED_VERSION} --depth 1 https://github.com/opszn/locade.git`,
      ),
    );
    for (const command of [
      'npm ci',
      'npm ci --registry=https://registry.npmmirror.com',
      'npm run build',
      'npm start',
      'npm exec --no -- playwright install chromium',
    ])
      assert.ok(shell.includes(command));
    assert.doesNotMatch(
      shell,
      /npm config set|strict-ssl=false|curl.*\|.*sh|npx locade|kill\s|sudo\s/,
    );
    assert.match(text, /22\.13\+/);
    assert.match(text, /v3/);
    assert.match(text, /v2/);
    assert.match(text, /ALPHA2_RELEASE_NOTES/);
    assert.match(
      commands(text).flat().join('\n'),
      /git checkout --detach [a-f0-9]{40}/,
    );
    assert.match(text, /LOCADE_DATA_DIR="\$PWD\/\.locade"/);
  }
  assert.match(english, /does not change the browser download/);
  assert.match(english, /files.*does not prove.*launch/i);
  assert.match(english, /without Chromium.*discover, favorite, and open/i);
  assert.match(english, /separate empty data directory/);
  assert.match(chinese, /独立的空资料目录/);
  for (const [text, warning] of [
    [english, 'If you have already used Alpha.2'],
    [chinese, '如果已用过 Alpha.2'],
  ]) {
    const position = text.indexOf(warning);
    assert.ok(position >= 0 && position < text.indexOf('```sh'));
  }
});

test('English quick-start labels resolve to the implemented UI without translating user content', async () => {
  const english = await read('docs/QUICK_START.md');
  const known = new Set(Object.values(messages));
  for (const label of [
    'Quick start',
    'Privacy & screenshots',
    'Allow local screenshots',
    'Capture screenshot',
    'Open project',
    'Review same names',
    'Retry image cleanup',
  ]) {
    assert.ok(english.includes(`**${label}**`), label);
    assert.ok(
      [...known].some((value) => value.trim() === label),
      label,
    );
  }
  assert.match(english, /names, paths, and Git branches.*not translated/i);
  assert.match(english, /Alpha\.1.*Chinese/i);
});

test('release notes keep historical Alpha.1 evidence separate from the unreleased Alpha.2 draft', async () => {
  for (const file of ['docs/RELEASE_NOTES.md', 'docs/RELEASE_NOTES.en.md']) {
    const text = await read(file);
    for (const value of [
      `v${PUBLISHED_VERSION}`,
      '39892036075',
      '74/74',
      '10/10',
      '7/7',
    ])
      assert.ok(text.includes(value), file);
    assert.doesNotMatch(text, /118\/118|124\/124/);
    assert.match(text, /ALPHA2_RELEASE_NOTES/);
  }
  const en = await read('docs/ALPHA2_RELEASE_NOTES.en.md');
  const zh = await read('docs/ALPHA2_RELEASE_NOTES.md');
  assert.match(en, /Unreleased draft/);
  for (const text of [en, zh]) assert.ok(text.includes(`v${APP_VERSION}`));
  assert.match(zh, /未发布草稿/);
  assert.match(en, /merged into.*main/i);
  assert.match(zh, /已合入.*main/);
  assert.doesNotMatch(en, /These increments remain under review/);
  for (const text of [en, zh]) {
    for (const value of [
      'v3',
      'v2',
      'before-restore.json',
      'library.v2.backup.json',
      'FEEDBACK.md',
    ])
      assert.ok(text.includes(value));
    assert.ok(text.includes(`v${PUBLISHED_VERSION}`));
  }
  assert.match(en, /not.*power-loss/i);
  assert.match(en, /real.*one-week/i);
  assert.match(en, /not.*native.*acceptance/i);
});

test('both Markdown issue templates have valid metadata, bilingual reproduction fields, and privacy-first guidance', async () => {
  const folder = '.github/ISSUE_TEMPLATE';
  assert.deepEqual((await readdir(path.join(root, folder))).sort(), [
    '1-bug-report.md',
    '2-first-use.md',
    'config.yml',
  ]);
  for (const name of ['1-bug-report.md', '2-first-use.md']) {
    const text = await read(`${folder}/${name}`);
    const header = text.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(header, name);
    await format(header[1], { parser: 'yaml' });
    const fields = Object.fromEntries(
      header[1].split('\n').map((line) => {
        const match = line.match(
          /^(name|about|title|labels|assignees): (".*")$/,
        );
        assert.ok(match, `${name}: ${line}`);
        return [match[1], JSON.parse(match[2])];
      }),
    );
    assert.equal(Object.keys(fields).length, 5);
    assert.ok(fields.name.length > 3);
    assert.equal(fields.labels, '');
    assert.equal(fields.assignees, '');
    for (const field of [
      'Version / 版本',
      'Environment / 环境',
      'Steps / 复现步骤',
      'Expected / 预期',
      'Actual / 实际',
      'Privacy / 隐私',
    ])
      assert.ok(text.includes(field), `${name}: ${field}`);
    for (const value of [
      'macOS',
      'Node',
      'npm',
      'git rev-parse --short HEAD',
      'security/advisories/new',
    ])
      assert.ok(text.includes(value), name);
    assert.match(text, /Do not attach.*screenshots.*backups/i);
    assert.match(text, /不要.*资料库.*截图.*备份/);
    assert.match(text, /session token/);
    assert.match(text, /not.*automatically.*redact/i);
    assert.match(text, /not tried|not tested/i);
  }
});

test('issue chooser routes sensitive reports privately, disables blank community reports, and never requests credentials', async () => {
  const config = await read('.github/ISSUE_TEMPLATE/config.yml');
  await format(config, { parser: 'yaml' });
  assert.match(config, /^blank_issues_enabled: false$/m);
  assert.match(config, /^contact_links:$/m);
  const urls = [...config.matchAll(/^\s+url: (https:\/\/\S+)$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(urls, [
    'https://github.com/opszn/locade/security/advisories/new',
  ]);
  assert.match(config, /私密/);
  assert.match(config, /private/i);
  const feedback = await read('docs/FEEDBACK.md');
  assert.match(feedback, /default branch/);
  assert.match(feedback, /默认分支/);
  assert.match(feedback, /not an automatic.*redaction/i);
  assert.match(feedback, /不.*自动.*脱敏/);
  assert.match(feedback, /do not.*disable.*security/i);
  assert.match(feedback, /不.*关闭.*安全/);
  assert.match(feedback, /server-side recognition, not visual acceptance/);
  assert.match(feedback, /不冒称.*目视验收/);
});

test('public entry points link to quick start, bilingual release notes and privacy-safe feedback', async () => {
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const text = await read(file);
    for (const target of [
      'docs/FEEDBACK.md',
      'docs/ALPHA2_RELEASE_NOTES',
      'docs/QUICK_START',
      'docs/RELEASE_NOTES',
    ])
      assert.ok(text.includes(target), `${file}: ${target}`);
    assert.match(
      text,
      file === 'README.md' ? /incomplete disk\s+cleanup/ : /清理未完成/,
    );
    assert.match(
      text,
      file === 'README.md' ? /main.*unreleased/i : /main.*未发布/,
    );
  }
  for (const file of ['CONTRIBUTING.md', 'SECURITY.md'])
    assert.match(await read(file), /docs\/FEEDBACK\.md/);
});

test('all relative links in the public onboarding and feedback documents resolve inside the repository', async () => {
  const files = [
    ...new Set([
      ...pairs.flat(),
      'docs/FEEDBACK.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
    ]),
  ];
  for (const file of files) {
    const text = (await read(file)).replace(/```[\s\S]*?```/g, '');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const resolved = path.resolve(
        root,
        path.dirname(file),
        decodeURIComponent(target.split('#')[0]),
      );
      assert.ok(
        resolved.startsWith(`${root}${path.sep}`),
        `${file}: ${target}`,
      );
      assert.equal((await stat(resolved)).isFile(), true, `${file}: ${target}`);
    }
  }
});
