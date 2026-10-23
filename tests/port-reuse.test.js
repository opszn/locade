import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { directoryIdentity } from '../server/identity.js';
import { Store } from '../server/store.js';
import { close, listen } from './helpers.js';

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-reuse-'));
  for (const name of ['a', 'b']) await mkdir(path.join(directory, name));
  const identities = {
    a: await directoryIdentity(path.join(directory, 'a'), 'auto'),
    b: await directoryIdentity(path.join(directory, 'b'), 'auto'),
  };
  let found = [];
  let inspected;
  let captures = 0;
  const { server, store } = await createApp({
    dataDir: path.join(directory, 'library'),
    discoverProjects: async () => ({ found, source: 'controlled regression' }),
    inspectProject: async (url) => ({ ...inspected, url }),
    capturePage: async () => {
      captures++;
      throw new Error('unexpected capture invocation');
    },
  });
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });
  const library = await (await fetch(`${base}/api/library`)).json();
  const request = async (route, input = {}, method = 'POST') => {
    const response = await fetch(`${base}/api/${route}`, {
      method,
      headers: { 'X-Locade-Token': library.token },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const item = (name, url, observation = `${name}:first`) => ({
    url,
    title: `Project ${name.toUpperCase()}`,
    identity: identities[name],
    observation,
  });
  return {
    base,
    token: library.token,
    server,
    store,
    request,
    item,
    found: (value) => (found = value),
    inspected: (value) => (inspected = value),
    captures: () => captures,
  };
}

test('scan blocks a reused address even when a saved primary uses a localhost alias', async (t) => {
  const context = await setup(t);
  const a = context.item('a', 'http://127.0.0.1:3000/');
  context.found([a]);
  let library = await context.request('scan');
  const id = library.projects[0].id;
  await context.request(`projects/${id}`, { favorite: true }, 'PATCH');
  context.inspected(a);
  library = await context.request('projects', {
    url: 'http://localhost:3000/',
  });
  assert.equal(library.projects.length, 1);
  assert.equal(library.projects[0].url, 'http://localhost:3000/');
  context.found([context.item('b', a.url)]);
  library = await context.request('scan');
  const retained = library.projects.find((project) => project.id === id);
  assert.equal(retained.online, false);
  assert.equal(retained.addressReused, true);
  assert.equal(retained.favorite, true);
  assert.equal(library.projects.length, 2);
  assert.equal(
    library.projects.find((project) => project.id !== id).favorite,
    false,
  );
});

test('manually adding a different owner invalidates the old online endpoint immediately', async (t) => {
  const context = await setup(t);
  const a = context.item('a', 'http://localhost:3000/');
  context.found([a]);
  let library = await context.request('scan');
  const id = library.projects[0].id;
  context.inspected(context.item('b', 'http://127.0.0.1:3000/'));
  library = await context.request('projects', {
    url: 'http://127.0.0.1:3000/',
  });
  const retained = library.projects.find((project) => project.id === id);
  assert.equal(retained.online, false);
  assert.equal(retained.endpoints[0].online, false);
  assert.equal(retained.addressReused, true);
  assert.equal(library.projects.filter((project) => project.online).length, 1);
  assert.equal(
    library.projects.find((project) => project.id !== id).screenshot,
    null,
  );
});

test('a changed listener also invalidates historical routes but not routes of the same owner', async (t) => {
  const context = await setup(t);
  const a = context.item('a', 'http://localhost:3000/notes');
  context.found([a, { ...a, url: 'http://127.0.0.1:3000/' }]);
  let library = await context.request('scan');
  assert.equal(library.projects.length, 2);
  assert.ok(
    library.projects.every(
      (project) => project.online && !project.addressReused,
    ),
  );
  const ids = new Set(library.projects.map((project) => project.id));
  context.inspected(context.item('b', 'http://127.0.0.1:3000/'));
  library = await context.request('projects', {
    url: 'http://127.0.0.1:3000/',
  });
  for (const project of library.projects.filter((project) =>
    ids.has(project.id),
  )) {
    assert.equal(project.online, false);
    assert.equal(project.addressReused, true);
  }
});

test('a reused primary switches to another confirmed endpoint of the original project', async (t) => {
  const context = await setup(t);
  const a = context.item('a', 'http://127.0.0.1:3000/');
  context.found([a]);
  let library = await context.request('scan');
  const id = library.projects[0].id;
  await context.store.transaction(() => {
    context.store.state.projects[0].endpoints.push({
      url: 'http://[::1]:3000/',
      online: true,
      observation: 'a:first',
      lastSeen: new Date().toISOString(),
    });
  });
  context.inspected(context.item('b', a.url));
  library = await context.request('projects', { url: a.url });
  const retained = library.projects.find((project) => project.id === id);
  assert.equal(retained.online, true);
  assert.equal(retained.url, 'http://[::1]:3000/');
  assert.equal(retained.addressReused, false);
  assert.equal(
    retained.endpoints.find((endpoint) => endpoint.url === a.url).online,
    false,
  );
});

test('a reused-address safety marker survives an empty scan and restart until the original owner returns', async (t) => {
  const context = await setup(t);
  const a = context.item('a', 'http://localhost:3000/');
  context.found([a]);
  let library = await context.request('scan');
  const id = library.projects[0].id;
  context.inspected(context.item('b', 'http://127.0.0.1:3000/'));
  await context.request('projects', { url: 'http://127.0.0.1:3000/' });
  context.found([]);
  library = await context.request('scan');
  assert.equal(
    library.projects.find((project) => project.id === id).addressReused,
    true,
  );
  await close(context.server);
  // Restart from persisted metadata only after the first API owner has stopped.
  const restarted = new Store(context.store.directory);
  await restarted.init();
  assert.equal(
    restarted.state.projects.find((project) => project.id === id).addressReused,
    true,
  );
  restarted.upsert({ ...a, observation: 'a:restarted' });
  assert.equal(
    restarted.state.projects.find((project) => project.id === id).addressReused,
    false,
  );
  assert.equal(
    restarted.state.projects.find((project) => project.id !== id).addressReused,
    true,
  );
});

test('different paths served by the same listener are not invalidated by differing directory bindings', async (t) => {
  const context = await setup(t);
  context.found([
    context.item('a', 'http://localhost:3000/notes', 'shared:listener'),
    context.item('b', 'http://127.0.0.1:3000/', 'shared:listener'),
  ]);
  const library = await context.request('scan');
  assert.equal(library.projects.length, 2);
  assert.ok(
    library.projects.every(
      (project) => project.online && !project.addressReused,
    ),
  );
});

test('the screenshot API blocks a known reused address even when titles match and current ownership is unknown', async (t) => {
  const context = await setup(t);
  const first = { url: 'http://localhost:3000/', title: 'Vite + React' };
  context.found([first]);
  let library = await context.request('scan');
  const id = library.projects[0].id;
  await context.request('settings', { screenshotsEnabled: true }, 'PATCH');
  context.found([{ ...first, observation: 'new:listener' }]);
  library = await context.request('scan');
  assert.equal(
    library.projects.find((project) => project.id === id).addressReused,
    true,
  );
  context.inspected(first);
  const response = await fetch(
    `${context.base}/api/projects/${id}/screenshot`,
    {
      method: 'POST',
      headers: { 'X-Locade-Token': context.token },
    },
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /复用/);
  assert.equal(context.captures(), 0);
});

test('a matching default title alone cannot reclaim a known displaced project or its favorites', async (t) => {
  const context = await setup(t);
  const original = { url: 'http://localhost:3000/', title: 'Vite + React' };
  context.found([original]);
  const first = await context.request('scan');
  const id = first.projects[0].id;
  await context.request(
    `projects/${id}`,
    { favorite: true, name: 'My original' },
    'PATCH',
  );
  context.found([{ ...original, title: 'New service' }]);
  await context.request('scan');
  context.found([original]);
  const library = await context.request('scan');
  const retained = library.projects.find((project) => project.id === id);
  assert.equal(retained.online, false);
  assert.equal(retained.addressReused, true);
  assert.equal(retained.favorite, true);
  assert.equal(retained.name, 'My original');
  const current = library.projects.find((project) => project.online);
  assert.notEqual(current.id, id);
  assert.equal(current.favorite, false);
  assert.equal(current.screenshot, null);
});
