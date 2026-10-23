import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localUrl,
  parseListeningPorts,
  probe,
  mapLimit,
  listeningPorts,
  discover,
} from '../server/network.js';
import { fixture, close } from './helpers.js';

test('URL validation permits only loopback HTTP(S), excludes credentials and own port', () => {
  for (const url of [
    'http://localhost:3000/path?q=1',
    'https://127.0.0.1/',
    'http://[::1]:5173/',
  ])
    assert.ok(localUrl(url));
  for (const url of [
    'https://example.com',
    'http://localhost.evil:3000',
    'http://192.168.1.1',
    'file:///etc/passwd',
    'http://user:pass@localhost:3000',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => localUrl(url));
  }
  assert.throws(() => localUrl('http://localhost:4400', 4400));
  assert.equal(
    localUrl('http://localhost:3000/path#secret').href,
    'http://localhost:3000/path',
  );
});

test('lsof parser supports wildcard, IPv4, IPv6 and duplicate descriptors', () => {
  assert.deepEqual(
    parseListeningPorts(
      'p123\nn*:3000\nn127.0.0.1:5173\nn[::1]:8080\nn*:3000\nninvalid\n',
    ),
    [3000, 5173, 8080],
  );
});

test('probes find HTML titles, reject JSON/redirects, and time out', async (t) => {
  const local = await fixture();
  t.after(() => close(local.server));
  assert.equal((await probe(`${local.url}/`)).title, 'Sprout Studio');
  assert.equal(
    (await probe(`${local.url.replace('127.0.0.1', 'localhost')}/notes`)).title,
    'Field Notes',
  );
  assert.equal(await probe(`${local.url}/json`), null);
  assert.equal(await probe(`${local.url}/redirect`), null);
  const start = Date.now();
  assert.equal(await probe(`${local.url}/slow`, 80), null);
  assert.ok(Date.now() - start < 1000);
  assert.equal(await probe('https://127.0.0.1:1/', 80), null);
});

test('port inventory includes a real local listener or explicitly reports fallback', async (t) => {
  const local = await fixture();
  t.after(() => close(local.server));
  const inventory = await listeningPorts();
  assert.ok(
    inventory.source !== 'lsof' ||
      inventory.ports.includes(Number(new URL(local.url).port)),
  );
});

test('worker pool bounds concurrency and preserves order', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test('saved endpoints never probe the management port after it moves onto an old project address', async (t) => {
  const management = await fixture();
  const project = await fixture();
  t.after(async () => {
    await close(management.server);
    await close(project.server);
  });
  const port = Number(new URL(management.url).port);
  const result = await discover(
    port,
    [
      `${management.url}/`,
      `${management.url.replace('127.0.0.1', 'localhost')}/`,
      `http://[::1]:${port}/`,
      `${project.url}/`,
      'https://example.invalid/',
    ],
    { inventory: async () => ({ ports: [port], source: 'fixture' }) },
  );
  assert.deepEqual(management.requests, []);
  assert.equal(result.found.length, 1);
  assert.equal(result.found[0].url, `${project.url}/`);
  assert.equal(result.found[0].title, 'Sprout Studio');
});

test('probe diagnostics distinguish HTTP errors, redirects, timeouts and refused connections', async (t) => {
  const local = await fixture();
  t.after(() => close(local.server));
  async function reason(url, timeout = 100) {
    let failure;
    assert.equal(
      await probe(url, timeout, (value) => {
        failure = value;
      }),
      null,
    );
    return failure;
  }
  assert.match((await reason(`${local.url}/redirect`)).reason, /重定向/);
  assert.equal((await reason(`${local.url}/slow`, 50)).status, 'unknown');
  local.setOnline(false);
  const http = await reason(`${local.url}/`);
  assert.equal(http.status, 'error');
  assert.equal(http.reason, 'HTTP 503');
  await close(local.server);
  assert.equal((await reason(`${local.url}/`)).status, 'offline');
});
