import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../server/store.js';

test('library persists favorites, deduplicates aliases and starts offline after restart', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.init();
  assert.equal(store.state.screenshotsEnabled, false);
  await store.transaction(() => {
    store.upsert({ url: 'http://localhost:3000/', title: 'Garden' }).favorite =
      true;
    store.upsert({ url: 'http://127.0.0.1:3000/', title: 'Garden' });
  });
  assert.equal(store.state.projects.length, 1);
  const next = new Store(directory);
  await next.init();
  assert.equal(next.state.projects[0].favorite, true);
  assert.equal(next.state.projects[0].online, false);
  assert.equal((await stat(next.file)).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
});

test('transactions serialize writes and recover after a failed operation', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.init();
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      store.transaction(() => {
        store.upsert({
          url: `http://localhost:${3000 + index}/`,
          title: `Project ${index}`,
        });
      }),
    ),
  );
  await assert.rejects(
    store.transaction(() => {
      store.state.projects = [];
      throw new Error('abort');
    }),
  );
  assert.equal(store.state.projects.length, 10);
  await store.transaction(() => {
    store.state.screenshotsEnabled = true;
  });
  assert.equal(
    JSON.parse(await readFile(store.file, 'utf8')).projects.length,
    10,
  );
});

test('corrupt data is not silently overwritten', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'library.json'), '{broken');
  await assert.rejects(new Store(directory).init());
  assert.equal(
    await readFile(path.join(directory, 'library.json'), 'utf8'),
    '{broken',
  );
});
