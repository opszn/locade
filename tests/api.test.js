import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createApp } from '../server/index.js';
import { probe } from '../server/network.js';
import { close, listen, fixture } from './helpers.js';

test('API lifecycle: discovery, favorites, capture consent/deletion, manual URLs and offline retention', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'locade-api-'));
  const local = await fixture();
  let captureFails = false;
  const { server, store } = await createApp({
    dataDir,
    discoverProjects: async () => ({
      found: [await probe(`${local.url}/`)].filter(Boolean),
      source: 'test fixture',
    }),
    capturePage: async (_url, destination) => {
      if (captureFails) {
        await writeFile(destination, 'partial');
        throw new Error('capture failed');
      }
      await writeFile(destination, 'test image');
    },
  });
  const base = await listen(server);
  t.after(async () => {
    await close(server);
    await close(local.server);
    await rm(dataDir, { recursive: true, force: true });
  });
  const initial = await (await fetch(`${base}/api/library`)).json();
  const api = async (endpoint, method, data) => {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method,
      headers: {
        'X-Locade-Token': initial.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data || {}),
    });
    return { status: response.status, data: await response.json() };
  };
  assert.equal(initial.screenshotsEnabled, false);
  assert.equal(
    (await fetch(`${base}/api/scan`, { method: 'POST' })).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/library`, {
        headers: { Origin: 'https://evil.invalid' },
      })
    ).status,
    403,
  );
  const rejectedHost = await new Promise((resolve, reject) => {
    http
      .get(
        `${base}/api/library`,
        { headers: { Host: 'evil.invalid' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      )
      .on('error', reject);
  });
  assert.equal(rejectedHost, 403);
  assert.equal(
    (
      await fetch(`${base}/api/library`, {
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await api('projects', 'POST', { url: 'http://192.168.1.1/' })).status,
    400,
  );
  assert.equal((await api('projects', 'POST', { url: base })).status, 400);
  let result = await api('scan', 'POST');
  const id = result.data.projects[0].id;
  assert.equal(result.data.projects[0].name, 'Sprout Studio');
  assert.equal(result.data.projects[0].online, true);
  assert.equal((await api(`projects/${id}/screenshot`, 'POST')).status, 400);
  result = await api(`projects/${id}`, 'PATCH', { favorite: true });
  assert.equal(result.data.projects[0].favorite, true);
  await api('settings', 'PATCH', { screenshotsEnabled: true });
  result = await api(`projects/${id}/screenshot`, 'POST');
  assert.ok(result.data.projects[0].screenshot);
  assert.equal((await fetch(`${base}/screenshots/${id}.png`)).status, 200);
  captureFails = true;
  assert.equal((await api(`projects/${id}/screenshot`, 'POST')).status, 400);
  assert.equal(
    await readFile(path.join(store.screenshots, `${id}.png`), 'utf8'),
    'test image',
  );
  await assert.rejects(access(path.join(store.screenshots, `${id}.png.tmp`)));
  captureFails = false;
  await api(`projects/${id}/screenshot`, 'DELETE');
  assert.equal((await fetch(`${base}/screenshots/${id}.png`)).status, 404);
  await api(`projects/${id}/screenshot`, 'POST');
  await api('settings', 'PATCH', { screenshotsEnabled: false });
  await assert.rejects(access(path.join(store.screenshots, `${id}.png`)));
  result = await api(`projects/${id}/opened`, 'POST');
  assert.ok(result.data.projects[0].lastOpened);
  result = await api('projects', 'POST', { url: `${local.url}/notes` });
  assert.equal(result.data.projects.length, 2);
  await api(`projects/${id}`, 'PATCH', { name: 'My garden' });
  local.setOnline(false);
  result = await api('scan', 'POST');
  assert.equal(result.data.projects.length, 2);
  assert.equal(result.data.projects[0].online, false);
  assert.equal(result.data.projects[0].favorite, true);
  assert.equal(result.data.projects[0].name, 'My garden');
  await api(`projects/${id}`, 'DELETE');
  assert.equal(store.state.projects.length, 1);
});
