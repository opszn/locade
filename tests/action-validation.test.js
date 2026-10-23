import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.js';
import { directoryIdentity } from '../server/identity.js';
import { close, listen } from './helpers.js';

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'locade-action-'));
  for (const name of ['a', 'b']) await mkdir(path.join(dir, name));
  const identity = await directoryIdentity(path.join(dir, 'a'), 'auto');
  let current = {
    url: 'http://127.0.0.1:3000/',
    title: 'Same title',
    identity,
    observation: '101:fixture',
  };
  let inspections = 0;
  const { server, store } = await createApp({
    dataDir: path.join(dir, 'data'),
    discoverProjects: async () => ({ found: [current] }),
    inspectProject: async () => {
      inspections++;
      return current;
    },
    capturePage: async (_url, destination) =>
      writeFile(
        destination,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      ),
  });
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    await rm(dir, { recursive: true, force: true });
  });
  const initial = await (await fetch(`${base}/api/library`)).json();
  const api = (endpoint, input = {}, method = 'POST') =>
    fetch(`${base}/api/${endpoint}`, {
      method,
      headers: { 'X-Locade-Token': initial.token },
      body: JSON.stringify(input),
    });
  const scan = await (await api('scan')).json();
  return {
    dir,
    store,
    base,
    api,
    first: scan.projects[0],
    current: () => current,
    change: (value) => {
      current = value;
    },
    inspections: () => inspections,
  };
}

test('invalid multi-field project patches never delete an existing screenshot or break backup', async (t) => {
  const { store, api, first } = await setup(t);
  await api('settings', { screenshotsEnabled: true }, 'PATCH');
  assert.equal((await api(`projects/${first.id}/screenshot`)).status, 200);
  const file = path.join(store.screenshots, `${first.id}.png`);
  const original = await readFile(file);
  const metadata = await readFile(store.file, 'utf8');
  for (const input of [
    { captureAllowed: false, name: '' },
    { captureAllowed: false, favorite: 'yes' },
    { hidden: true, captureAllowed: false, name: 123 },
  ]) {
    assert.equal(
      (await api(`projects/${first.id}`, input, 'PATCH')).status,
      400,
    );
    assert.deepEqual(await readFile(file), original);
    assert.equal(await readFile(store.file, 'utf8'), metadata);
  }
  assert.equal((await api('backup', { includeScreenshots: true })).status, 200);
});

test('server-side navigation rejects a reused card even when a stale window still has its old link', async (t) => {
  const s = await setup(t);
  s.change({
    ...s.current(),
    identity: await directoryIdentity(path.join(s.dir, 'b'), 'auto'),
    observation: '202:replacement',
  });
  await s.api('scan');
  const reads = s.inspections();
  const response = await fetch(`${s.base}/open/${s.first.id}`, {
    redirect: 'manual',
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
  assert.equal(
    s.inspections(),
    reads,
    'known reuse rejects before probing the new owner',
  );
  assert.equal((await s.api(`projects/${s.first.id}/opened`)).status, 400);
  assert.equal(
    s.store.state.projects.find((p) => p.id === s.first.id).lastOpened,
    null,
  );
});

test('navigation rechecks the live owner and only redirects to the confirmed local URL', async (t) => {
  const s = await setup(t);
  const original = s.current();
  for (const next of [
    { ...original, observation: '202:changed' },
    { ...original, observation: null },
    { ...original, url: 'https://example.invalid/' },
    null,
  ]) {
    s.change(next);
    const response = await fetch(`${s.base}/open/${s.first.id}`, {
      redirect: 'manual',
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
    assert.equal(s.store.state.projects[0].lastOpened, null);
  }
  s.change(original);
  const response = await fetch(`${s.base}/open/${s.first.id}`, {
    redirect: 'manual',
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), original.url);
  assert.ok(s.store.state.projects[0].lastOpened);
  const count = s.inspections();
  assert.equal(
    (
      await fetch(`${s.base}/open/${s.first.id}`, {
        headers: { 'Sec-Fetch-Site': 'cross-site' },
        redirect: 'manual',
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${s.base}/open/${s.first.id}`, { method: 'HEAD' })).status,
    405,
  );
  assert.equal(s.inspections(), count);
});

test('directory binding rejects canonical alias duplicates without deleting either cover', async (t) => {
  const s = await setup(t);
  const legacy = s.store.upsert({
    url: 'http://localhost:3000/',
    title: 'Legacy',
    observation: '303:legacy',
  });
  assert.notEqual(legacy.id, s.first.id);
  assert.equal(
    (
      await s.api(`projects/${legacy.id}/binding`, {
        directory: path.join(s.dir, 'a'),
      })
    ).status,
    400,
  );
  assert.equal(legacy.identity, null);
});
