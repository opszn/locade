import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server/index.js';
import { close, listen } from './helpers.js';

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'locade-review-'));
  const { server, store } = await createApp({ dataDir: dir });
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    await rm(dir, { recursive: true, force: true });
  });
  await store.transaction(() => {
    for (const port of [3000, 3001, 3002]) {
      const project = store.upsert({
        url: `http://127.0.0.1:${port}/`,
        title: 'Same name',
        observation: `${port}:fixture`,
      });
      project.favorite = port === 3000;
    }
  });
  const library = await (await fetch(`${base}/api/library`)).json();
  const api = (updates, token = library.token) =>
    fetch(`${base}/api/projects/visibility`, {
      method: 'POST',
      headers: { 'X-Locade-Token': token },
      body: JSON.stringify({ updates }),
    });
  return { dir, store, base, library, api };
}

test('review requires explicit versioned choices and hides/unhides without moving project metadata or images', async (t) => {
  const { store, base, library, api } = await setup(t);
  const before = structuredClone(store.state.projects);
  const selected = library.projects.slice(0, 2);
  const result = await api(
    selected.map((p) => ({ id: p.id, hidden: true, expected: p.reviewKey })),
  );
  assert.equal(result.status, 200);
  const after = await result.json();
  assert.equal(after.projects.filter((p) => p.hidden).length, 2);
  for (const original of before) {
    const current = store.state.projects.find((p) => p.id === original.id);
    assert.deepEqual({ ...current, hidden: original.hidden }, original);
  }
  const undo = await api(
    after.projects
      .filter((p) => p.hidden)
      .map((p) => ({ id: p.id, hidden: false, expected: p.reviewKey })),
  );
  assert.equal(undo.status, 200);
  assert.deepEqual(store.state.projects, before);
  assert.equal((await fetch(`${base}/api/library`)).status, 200);
});

test('a stale member aborts a complete review batch and stale undo cannot overwrite subsequent changes', async (t) => {
  const { store, library, api } = await setup(t);
  await store.transaction(() => {
    store.state.projects[1].name = 'Changed in another window';
  });
  const snapshot = structuredClone(store.state);
  const rejected = await api(
    library.projects
      .slice(0, 2)
      .map((p) => ({ id: p.id, hidden: true, expected: p.reviewKey })),
  );
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /重新载入/);
  assert.deepEqual(store.state, snapshot);
  const first = library.projects[0];
  const after = await (
    await api([{ id: first.id, hidden: true, expected: first.reviewKey }])
  ).json();
  const key = after.projects.find((p) => p.id === first.id).reviewKey;
  await store.transaction(() => {
    store.state.projects[0].favorite = false;
  });
  assert.equal(
    (await api([{ id: first.id, hidden: false, expected: key }])).status,
    400,
  );
  assert.equal(store.state.projects[0].hidden, true);
  assert.equal(store.state.projects[0].favorite, false);
});

test('invalid or unauthenticated review batches leave metadata and screenshot bytes intact', async (t) => {
  const { store, library, api } = await setup(t);
  const first = library.projects[0];
  const filename = path.join(store.screenshots, `${first.id}.png`);
  await writeFile(filename, 'synthetic image ownership fixture');
  const before = await readFile(store.file, 'utf8');
  const choice = { id: first.id, hidden: true, expected: first.reviewKey };
  for (const choices of [
    [],
    [choice, choice],
    [{ ...choice, hidden: 'true' }],
    [{ ...choice, id: 'missing' }],
    [{ ...choice, expected: null }],
    Array(101).fill(choice),
  ]) {
    assert.equal((await api(choices)).status, 400);
  }
  assert.equal((await api([choice], 'not-the-session-token')).status, 403);
  assert.equal(await readFile(store.file, 'utf8'), before);
  assert.equal(
    await readFile(filename, 'utf8'),
    'synthetic image ownership fixture',
  );
});
