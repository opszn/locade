import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { directoryIdentity } from '../server/identity.js';
import { listen, close } from './helpers.js';

test('API project identity: bind, port move/reuse, ignore persistence, per-project capture exclusion, export/import and integration whitelist', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-workflow-'));
  const app = path.join(root, 'app');
  const second = path.join(root, 'other');
  for (const directory of [app, second]) {
    await mkdir(directory);
    await writeFile(path.join(directory, 'package.json'), '{}');
  }
  const a = await directoryIdentity(app, 'auto');
  const b = await directoryIdentity(second, 'auto');
  let found = [
    {
      url: 'http://127.0.0.1:3000/',
      title: 'A',
      identity: a,
      observation: '1:date',
    },
  ];
  const opened = [];
  const { server, store } = await createApp({
    dataDir: path.join(root, 'data'),
    discoverProjects: async () => ({ found, source: 'fixture' }),
    inspectProject: async (url) => found.find((item) => item.url === url),
    openProjectDirectory: async (directory, editor) => {
      if (!['finder', 'vscode', 'cursor'].includes(editor))
        throw new Error('invalid editor');
      opened.push({ directory, editor });
    },
  });
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    await rm(root, { recursive: true, force: true });
  });
  const initial = await (await fetch(`${base}/api/library`)).json();
  const headers = {
    'Content-Type': 'application/json',
    'X-Locade-Token': initial.token,
  };
  const request = async (endpoint, method = 'POST', data = {}) => {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method,
      headers,
      body: JSON.stringify(data),
    });
    return { status: response.status, data: await response.json() };
  };
  let result = await request('scan');
  const id = result.data.projects[0].id;
  assert.equal(result.data.projects[0].identity.key, a.key);
  await request(`projects/${id}`, 'PATCH', { favorite: true, name: 'My app' });
  found = [
    { ...found[0], url: 'http://127.0.0.1:3001/', observation: '2:date' },
  ];
  result = await request('scan');
  assert.equal(result.data.projects.length, 1);
  assert.equal(result.data.projects[0].name, 'My app');
  assert.equal(result.data.projects[0].favorite, true);
  found.push({
    url: 'http://127.0.0.1:3000/',
    title: 'B',
    identity: b,
    observation: '3:date',
  });
  result = await request('scan');
  assert.equal(result.data.projects.length, 2);
  await request(`projects/${id}`, 'PATCH', {
    hidden: true,
    captureAllowed: false,
  });
  result = await request('scan');
  assert.equal(
    result.data.projects.find((item) => item.id === id).hidden,
    true,
  );
  await request('settings', 'PATCH', { screenshotsEnabled: true });
  assert.equal((await request(`projects/${id}/screenshot`)).status, 400);
  result = await request(`projects/${id}/binding`, 'POST', { directory: app });
  assert.equal(
    result.data.projects.find((item) => item.id === id).identity.source,
    'manual',
  );
  assert.equal(
    (
      await request(`projects/${id}/binding`, 'POST', {
        directory: path.join(root, 'missing'),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(`projects/${id}/open-directory`, 'POST', {
        editor: 'vscode',
      })
    ).status,
    200,
  );
  assert.deepEqual(opened, [{ directory: a.directory, editor: 'vscode' }]);
  assert.equal(
    (
      await request(`projects/${id}/open-directory`, 'POST', {
        editor: 'sh -c something',
      })
    ).status,
    400,
  );
  result = await request(`projects/${id}/binding`, 'DELETE');
  assert.equal(
    result.data.projects.find((item) => item.id === id).identity,
    null,
  );
  const backup = await fetch(`${base}/api/backup`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  assert.equal(backup.status, 200);
  const bytes = Buffer.from(await backup.arrayBuffer());
  assert.equal(
    (
      await fetch(`${base}/api/restore`, {
        method: 'POST',
        headers,
        body: bytes,
      })
    ).status,
    400,
  );
  const restored = await fetch(`${base}/api/restore`, {
    method: 'POST',
    headers: { ...headers, 'X-Locade-Confirm': 'replace-library' },
    body: bytes,
  });
  assert.equal(restored.status, 200);
  assert.equal(store.state.screenshotsEnabled, false);
  assert.equal(store.state.projects.length, 2);
  assert.ok(store.state.projects.every((item) => !item.online));
  assert.ok(
    (
      await readFile(path.join(store.directory, 'before-restore.json'), 'utf8')
    ).includes('My app'),
  );
  assert.equal((await fetch(`${base}/api/storage`)).status, 200);
});

test('capture rechecks live ownership and never overwrites an old cover after port reuse', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-ownership-'));
  const aDir = path.join(root, 'a');
  const bDir = path.join(root, 'b');
  await mkdir(aDir);
  await mkdir(bDir);
  const a = await directoryIdentity(aDir, 'auto');
  const b = await directoryIdentity(bDir, 'auto');
  let current = {
    url: 'http://127.0.0.1:3000/',
    title: 'Same title',
    identity: a,
    observation: '1:a',
  };
  let captures = 0;
  const { server } = await createApp({
    dataDir: path.join(root, 'data'),
    discoverProjects: async () => ({ found: [current], source: 'fixture' }),
    inspectProject: async () => current,
    capturePage: async (_url, destination) => {
      captures++;
      await writeFile(destination, 'old image');
    },
  });
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    await rm(root, { recursive: true, force: true });
  });
  const library = await (await fetch(`${base}/api/library`)).json();
  const api = async (endpoint) =>
    fetch(`${base}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'X-Locade-Token': library.token },
    });
  const found = await (await api('scan')).json();
  const id = found.projects[0].id;
  await fetch(`${base}/api/settings`, {
    method: 'PATCH',
    headers: { 'X-Locade-Token': library.token },
    body: JSON.stringify({ screenshotsEnabled: true }),
  });
  assert.equal((await api(`projects/${id}/screenshot`)).status, 200);
  current = { ...current, identity: b, observation: '2:b' };
  assert.equal((await api(`projects/${id}/screenshot`)).status, 400);
  assert.equal(captures, 1);
  const cover = await fetch(`${base}/screenshots/${id}.png`);
  assert.equal(await cover.text(), 'old image');
  const next = await (await api('scan')).json();
  assert.equal(next.projects.length, 2);
  assert.equal(
    next.projects.find((item) => item.id === id).addressReused,
    true,
  );
});
