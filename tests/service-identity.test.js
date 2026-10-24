import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store, urlKey } from '../server/store.js';
import { directoryIdentity } from '../server/identity.js';
import { createApp } from '../server/index.js';
import { listen, close } from './helpers.js';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-service-role-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'app');
  await mkdir(directory);
  const identity = await directoryIdentity(directory, 'auto');
  const store = new Store(path.join(root, 'data'));
  await store.init();
  const service = (port, title, observation) => ({
    url: `http://127.0.0.1:${port}/`,
    title,
    identity,
    observation,
  });
  const frontend = store.upsert(service(3000, 'Frontend', '101:started'));
  frontend.name = 'My frontend';
  frontend.favorite = true;
  frontend.screenshot = new Date().toISOString();
  const storybook = store.upsert(service(6006, 'Storybook', '102:started'));
  for (const project of store.state.projects) {
    project.online = false;
    for (const endpoint of project.endpoints) endpoint.online = false;
  }
  return { store, frontend, storybook, service };
}

test('a known process moving onto another service port in the same directory keeps its own identity', async (t) => {
  const { store, frontend, storybook, service } = await setup(t);
  const moved = store.upsert(service(3000, 'Storybook', '102:started'));
  assert.equal(moved.id, storybook.id);
  assert.equal(moved.favorite, false);
  assert.equal(moved.screenshot, null);
  assert.equal(frontend.name, 'My frontend');
  assert.equal(frontend.online, false);
  assert.equal(frontend.addressReused, true);
  assert.ok(frontend.screenshot);
  assert.equal(store.state.projects.length, 2);
});

test('ambiguous restarted services in a shared directory never inherit covers by old port alone', async (t) => {
  const { store, frontend, storybook, service } = await setup(t);
  const current = service(3000, 'Storybook', '103:restarted');
  const restarted = store.upsert(current);
  assert.notEqual(restarted.id, frontend.id);
  assert.notEqual(restarted.id, storybook.id);
  assert.equal(restarted.favorite, false);
  assert.equal(restarted.screenshot, null);
  assert.equal(frontend.addressReused, true);
  assert.equal(storybook.online, false);
  assert.equal(store.upsert(current).id, restarted.id);
  assert.equal(store.state.projects.length, 3);
});

test('shared-directory identity matching does not depend on scan result ordering', async (t) => {
  const { store, frontend, storybook, service } = await setup(t);
  assert.equal(
    store.upsert(service(6006, 'Frontend', '101:started')).id,
    frontend.id,
  );
  assert.equal(
    store.upsert(service(3000, 'Storybook', '102:started')).id,
    storybook.id,
  );
  assert.equal(frontend.url, 'http://127.0.0.1:6006/');
  assert.equal(storybook.url, 'http://127.0.0.1:3000/');
  assert.equal(frontend.addressReused, false);
  assert.equal(storybook.addressReused, false);
  assert.equal(frontend.favorite, true);
  assert.equal(storybook.favorite, false);
  assert.equal(store.state.projects.length, 2);
});

test('one process with concurrent ports does not merge distinct roles when a new endpoint is scanned first', async (t) => {
  const { store, frontend, storybook, service } = await setup(t);
  const found = [
    service(6006, 'Another frontend role', '101:started'),
    service(3000, 'Frontend', '101:started'),
  ];
  const added = store.upsert(found[0], false, found);
  assert.notEqual(added.id, frontend.id);
  assert.notEqual(added.id, storybook.id);
  assert.equal(store.upsert(found[1], false, found).id, frontend.id);
  assert.equal(frontend.url, 'http://127.0.0.1:3000/');
  assert.equal(frontend.favorite, true);
  assert.equal(storybook.addressReused, true);
  assert.equal(added.favorite, false);
  assert.equal(added.screenshot, null);
});

test('a single stored role expanding into two processes stays separate in either scan order', async (t) => {
  for (const reverse of [false, true]) {
    const { store, frontend, service } = await setup(t);
    store.state.projects = [frontend];
    const found = [
      service(6006, 'Storybook', '102:started'),
      service(3000, 'Frontend', '101:started'),
    ];
    if (reverse) found.reverse();
    const ids = found.map((item) => store.upsert(item, false, found).id);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(store.state.projects.length, 2);
    assert.equal(frontend.url, 'http://127.0.0.1:3000/');
    assert.equal(frontend.favorite, true);
    assert.ok(frontend.screenshot);
    const added = store.state.projects.find((item) => item.id !== frontend.id);
    assert.equal(added.url, 'http://127.0.0.1:6006/');
    assert.equal(added.favorite, false);
    assert.equal(added.screenshot, null);
  }
});

test('a known role moving away and a new role taking its port do not steal each other in either order', async (t) => {
  for (const reverse of [false, true]) {
    const { store, frontend, service } = await setup(t);
    store.state.projects = [frontend];
    const found = [
      service(3000, 'Storybook', '102:started'),
      service(6006, 'Frontend', '101:started'),
    ];
    if (reverse) found.reverse();
    const ids = found.map((item) => store.upsert(item, false, found).id);
    assert.notEqual(ids[0], ids[1]);
    assert.equal(store.state.projects.length, 2);
    assert.equal(frontend.url, 'http://127.0.0.1:6006/');
    assert.equal(frontend.favorite, true);
    assert.ok(frontend.screenshot);
    assert.equal(frontend.addressReused, false);
    const added = store.state.projects.find((item) => item.id !== frontend.id);
    assert.equal(added.url, 'http://127.0.0.1:3000/');
    assert.equal(added.favorite, false);
    assert.equal(added.screenshot, null);
  }
});

test('manual addition on a historical port cannot replace a still-confirmed different process role', async (t) => {
  const { store, frontend, service } = await setup(t);
  store.state.projects = [frontend];
  frontend.online = true;
  frontend.endpoints[0].online = true;
  frontend.endpoints.push({
    url: 'http://127.0.0.1:6006/',
    observation: '101:started',
    online: false,
  });
  const added = store.upsert(service(6006, 'Storybook', '102:started'), true);
  assert.notEqual(added.id, frontend.id);
  assert.equal(added.favorite, false);
  assert.equal(added.screenshot, null);
  assert.equal(frontend.online, true);
  assert.equal(frontend.url, 'http://127.0.0.1:3000/');
  assert.equal(frontend.addressReused, false);
  assert.equal(frontend.favorite, true);
});

test('successful historical endpoints with missing metadata still prevent directory-only role merging', async (t) => {
  for (const reverse of [false, true]) {
    for (const observation of [null, '101:started', '103:unassociated']) {
      const { store, frontend, service } = await setup(t);
      store.state.projects = [frontend];
      const found = [
        service(6006, 'Storybook', '102:started'),
        {
          url: 'http://localhost:3000/',
          title: 'Frontend',
          identity: null,
          observation,
        },
      ];
      if (reverse) found.reverse();
      const added = found.map((item) => store.upsert(item, false, found));
      const storybook = added.find((item) => item.url.endsWith(':6006/'));
      assert.notEqual(storybook.id, frontend.id);
      assert.equal(storybook.favorite, false);
      assert.equal(storybook.screenshot, null);
      assert.equal(urlKey(frontend.url), 'http://127.0.0.1:3000/');
      assert.equal(frontend.favorite, true);
      assert.ok(frontend.screenshot);
    }
  }
});

test('capture requires rediscovery when the saved listener changes even if the new service shares its directory and title', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-role-capture-'));
  const directory = path.join(root, 'app');
  await mkdir(directory);
  const identity = await directoryIdentity(directory, 'auto');
  const frontend = {
    url: 'http://127.0.0.1:3000/',
    title: 'Vite + React',
    identity,
    observation: '101:frontend',
  };
  const storybook = {
    ...frontend,
    url: 'http://127.0.0.1:6006/',
    observation: '102:storybook',
  };
  let current = frontend;
  let captures = 0;
  const { server, store } = await createApp({
    dataDir: path.join(root, 'data'),
    discoverProjects: async () => ({ found: [frontend, storybook] }),
    inspectProject: async () => current,
    capturePage: async (_url, destination) => {
      await writeFile(destination, `controlled image ${++captures}`);
    },
  });
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    await rm(root, { recursive: true, force: true });
  });
  const initial = await (await fetch(`${base}/api/library`)).json();
  const api = async (endpoint, data = {}, method = 'POST') =>
    fetch(`${base}/api/${endpoint}`, {
      method,
      headers: { 'X-Locade-Token': initial.token },
      body: JSON.stringify(data),
    });
  const library = await (await api('scan')).json();
  const id = library.projects.find((item) => item.url === frontend.url).id;
  await api('settings', { screenshotsEnabled: true }, 'PATCH');
  assert.equal((await api(`projects/${id}/screenshot`)).status, 200);
  const before = store.state.projects.find((item) => item.id === id).screenshot;
  current = { ...storybook, url: frontend.url };
  const rejected = await api(`projects/${id}/screenshot`);
  assert.equal(rejected.status, 400);
  assert.equal(captures, 1);
  assert.equal(
    store.state.projects.find((item) => item.id === id).screenshot,
    before,
  );
  assert.equal(
    await readFile(
      store.screenshotPath(store.state.projects.find((p) => p.id === id)),
      'utf8',
    ),
    'controlled image 1',
  );
});
