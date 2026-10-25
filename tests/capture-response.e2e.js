import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { probe } from '../server/network.js';
import { close, listen } from './helpers.js';

test(
  'real capture rejects error/non-HTML navigation responses and retains the previous cover until retry succeeds',
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-response-'));
    const fixturePath = `/${randomUUID()}`;
    let mode = 'ok';
    let requests = 0;
    const target = http.createServer((request, response) => {
      if (request.url !== fixturePath) {
        response.writeHead(404);
        response.end();
        return;
      }
      requests++;
      if (requests % 2 === 0 && mode === 'error') {
        response.writeHead(503, { 'Content-Type': 'text/html' });
        response.end(
          '<title>Temporary error</title><h1>Service rebuilding</h1>',
        );
      } else if (requests % 2 === 0 && mode === 'json') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"error":"not a page"}');
      } else {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          '<title>Recoverable project</title><h1>Keep this local cover</h1>',
        );
      }
    });
    const targetUrl = `${await listen(target)}${fixturePath}`;
    const { server, store } = await createApp({
      dataDir: directory,
      discoverProjects: async () => ({
        found: [await probe(targetUrl)],
        source: 'controlled local HTML',
      }),
      inspectProject: probe,
    });
    const base = await listen(server);
    t.after(async () => {
      await close(server);
      await close(target);
      await rm(directory, { recursive: true, force: true });
    });
    const library = await (await fetch(`${base}/api/library`)).json();
    const api = async (endpoint, data, method = 'POST') => {
      const response = await fetch(`${base}/api/${endpoint}`, {
        method,
        headers: { 'X-Locade-Token': library.token },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(20000),
      });
      return { status: response.status, value: await response.json() };
    };
    const initial = await api('scan');
    const id = initial.value.projects[0].id;
    await api('settings', { screenshotsEnabled: true }, 'PATCH');
    requests = 0;
    assert.equal((await api(`projects/${id}/screenshot`)).status, 200);
    const previousTimestamp = store.state.projects[0].screenshot;
    const image = () => store.screenshotPath(store.state.projects[0]);
    const hash = async () =>
      createHash('sha256')
        .update(await readFile(image()))
        .digest('hex');
    const previousHash = await hash();
    for (mode of ['error', 'json']) {
      requests = 0;
      const response = await api(`projects/${id}/screenshot`);
      assert.equal(
        requests,
        2,
        'inspection succeeds before the capture navigation response changes',
      );
      assert.equal(response.status, 400);
      assert.match(
        response.value.error,
        mode === 'error' ? /HTTP 503/ : /HTML/,
      );
      assert.equal(store.state.projects[0].screenshot, previousTimestamp);
      assert.equal(await hash(), previousHash);
    }
    mode = 'ok';
    requests = 0;
    assert.equal((await api(`projects/${id}/screenshot`)).status, 200);
    assert.notEqual(store.state.projects[0].screenshot, previousTimestamp);
    assert.equal(
      (await readFile(image())).subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a',
    );
  },
);
