import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Store } from '../server/store.js';
import { exportBackup, parseBackup, restoreBackup } from '../server/backup.js';
import { acquireInstance } from '../server/instance.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64',
);
async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.init();
  return store;
}

test('backups round-trip pictures only with consent, remap IDs, leave metadata recovery, collect orphan images', async (t) => {
  const store = await setup(t);
  await store.transaction(async () => {
    const project = store.upsert({
      url: 'http://localhost:3000/',
      title: 'Garden',
    });
    project.favorite = true;
    project.screenshot = new Date().toISOString();
    store.state.screenshotsEnabled = true;
    await writeFile(path.join(store.screenshots, `${project.id}.png`), png);
  });
  const old = structuredClone(store.state.projects[0]);
  const archive = parseBackup(await exportBackup(store, true));
  assert.deepEqual(archive.images.get(old.id), png);
  const metadata = parseBackup(await exportBackup(store));
  assert.equal(metadata.state.projects[0].screenshot, null);
  assert.equal(metadata.images.size, 0);
  await restoreBackup(store, archive, true);
  const restored = store.state.projects[0];
  assert.notEqual(restored.id, old.id);
  assert.equal(restored.favorite, true);
  assert.equal(restored.online, false);
  assert.deepEqual(await readFile(store.screenshotPath(restored)), png);
  await assert.rejects(access(path.join(store.screenshots, `${old.id}.png`)));
  const recovery = JSON.parse(
    await readFile(path.join(store.directory, 'before-restore.json')),
  );
  assert.equal(recovery.projects[0].screenshot, null);
  await restoreBackup(store, archive, false);
  assert.equal(store.state.screenshotsEnabled, false);
  assert.equal(store.state.projects[0].screenshot, null);
});

test('untrusted archives reject traversal IDs, remote URLs, invalid dates, duplicate IDs, and decompression bombs without modifying data', async (t) => {
  const store = await setup(t);
  store.upsert({ url: 'http://localhost:3000/', title: 'Safe' });
  const original = await exportBackup(store);
  for (const mutate of [
    (archive) => {
      archive.state.projects[0].id = '../private';
    },
    (archive) => {
      archive.state.projects[0].url = 'https://evil.invalid/';
    },
    (archive) => {
      archive.state.projects[0].lastOpened = 'invalid';
    },
    (archive) => {
      archive.state.projects.push(archive.state.projects[0]);
    },
    (archive) => {
      archive.images['../anything'] = png.toString('base64');
    },
    (archive) => {
      archive.state.autoRefresh = 'yes';
    },
  ]) {
    const input = JSON.parse(gunzipSync(original));
    mutate(input);
    assert.throws(() => parseBackup(gzipSync(JSON.stringify(input))));
  }
  assert.throws(() => parseBackup(Buffer.from('not gzip')));
  assert.throws(() => parseBackup(gzipSync(Buffer.alloc(49 * 1024 * 1024))));
  assert.equal(store.state.projects[0].name, 'Safe');
});

test('single instance locks reject concurrent owners and can be cleanly reacquired', async (t) => {
  const store = await setup(t);
  const release = await acquireInstance(store.directory);
  await assert.rejects(acquireInstance(store.directory), /已有/);
  await release();
  const next = await acquireInstance(store.directory);
  await next();
  await writeFile(path.join(store.directory, 'instance.lock'), 'broken');
  await assert.rejects(acquireInstance(store.directory), /损坏/);
});

test('backup restoration preserves current and legacy reused-address safety markers', async (t) => {
  const store = await setup(t);
  const first = store.upsert({
    url: 'http://localhost:3000/',
    title: 'Original',
    observation: 'old:listener',
  });
  store.upsert({
    url: 'http://127.0.0.1:3000/',
    title: 'Replacement',
    observation: 'new:listener',
  });
  assert.equal(first.addressReused, true);
  const archive = parseBackup(await exportBackup(store));
  for (const legacy of [false, true]) {
    if (legacy) delete archive.state.projects[0].endpoints[0].addressReused;
    await restoreBackup(store, archive, false);
    assert.equal(store.state.projects[0].addressReused, true);
    assert.equal(store.state.projects[0].online, false);
    assert.equal(store.state.projects[1].addressReused, false);
  }
});
