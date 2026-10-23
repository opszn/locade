import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { sendNavigationError } from '../server/navigation-error.js';

test('all application decisions use owned UI instead of browser dialogs or validation bubbles', async () => {
  const directory = new URL('../src/', import.meta.url);
  for (const file of (await readdir(directory)).filter((name) =>
    /\.(jsx|js)$/.test(name),
  )) {
    const source = await readFile(new URL(file, directory), 'utf8');
    assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/, file);
    for (const form of source.matchAll(/<form\b([\s\S]*?)>/g))
      assert.match(
        form[1],
        /\bnoValidate\b/,
        `${file} must own validation feedback`,
      );
  }
});

test('failed browser navigation renders an owned local page and escapes untrusted messages', () => {
  let status, headers, html;
  sendNavigationError(
    {
      writeHead: (code, values) => {
        status = code;
        headers = values;
      },
      end: (content) => (html = content),
    },
    '<script>alert("secret")</script>',
  );
  assert.equal(status, 400);
  assert.match(headers['Content-Type'], /text\/html/);
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.match(html, /无法打开项目 · Locade/);
  assert.match(html, /href="\/"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
