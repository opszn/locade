import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discover, inspectUrl } from '../server/network.js';
import { parseListeners } from '../server/identity.js';
import { listen, close } from './helpers.js';

const exec = promisify(execFile);
const owned = (pid, port) => [{ pid, port }];
const metadata = (pid) => ({
  identity: { key: `fixture:${pid}`, directory: `/fixture/${pid}` },
  observation: `${pid}:fixture-start`,
});

async function pageFixture(t) {
  const route = `/${randomUUID()}`;
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (!request.url.startsWith(route)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<title>Owned fixture page</title><h1>Temporary fixture</h1>');
  });
  const base = await listen(server);
  t.after(() => close(server));
  return { url: `${base}${route}`, port: server.address().port, requests };
}

test('discovery verifies one port twice for all its successful routes and only then attaches process metadata', async (t) => {
  const fixture = await pageFixture(t);
  let reads = 0;
  let identities = 0;
  const result = await discover(-1, [fixture.url, `${fixture.url}/notes`], {
    inventory: async () => ({
      ports: [],
      listeners: owned(101, fixture.port),
      source: 'controlled ownership',
    }),
    inspectListeners: async (port) => {
      assert.equal(port, fixture.port);
      reads++;
      return owned(101, port);
    },
    identifyProcess: async (pid) => {
      assert.equal(pid, 101);
      identities++;
      return metadata(pid);
    },
  });
  assert.equal(result.found.length, 2);
  assert.ok(result.found.every((item) => item.identity.key === 'fixture:101'));
  assert.equal(reads, 2, 'listener checks are grouped by port, not URL');
  assert.equal(identities, 1);
});

test('discovery discards ownership when it changed before the response or while metadata was read', async (t) => {
  const fixture = await pageFixture(t);
  for (const phase of ['response', 'metadata']) {
    let reads = 0;
    let identities = 0;
    const result = await discover(-1, [fixture.url], {
      inventory: async () => ({
        ports: [],
        listeners: owned(101, fixture.port),
        source: 'controlled ownership',
      }),
      inspectListeners: async (port) => {
        reads++;
        return owned(phase === 'response' || reads > 1 ? 202 : 101, port);
      },
      identifyProcess: async (pid) => {
        identities++;
        return metadata(pid);
      },
    });
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].identity, undefined, phase);
    assert.equal(result.found[0].observation, undefined, phase);
    assert.equal(identities, phase === 'response' ? 0 : 1);
  }
});

test('missing or ambiguous initial owners never trigger system metadata queries', async (t) => {
  const fixture = await pageFixture(t);
  for (const listeners of [
    undefined,
    [],
    [...owned(101, fixture.port), ...owned(202, fixture.port)],
  ]) {
    const result = await discover(-1, [fixture.url], {
      inventory: async () => ({ ports: [], listeners, source: 'fixture' }),
      inspectListeners: async () => assert.fail('no unique initial owner'),
      identifyProcess: async () => assert.fail('no unique initial owner'),
    });
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].identity, undefined);
    assert.equal(result.found[0].observation, undefined);
  }
});

test('failed or ambiguous listener rechecks keep a page unassociated rather than failing discovery', async (t) => {
  const fixture = await pageFixture(t);
  for (const current of ['failed', 'missing', 'ambiguous']) {
    const result = await discover(-1, [fixture.url], {
      inventory: async () => ({
        ports: [],
        listeners: owned(101, fixture.port),
        source: 'fixture',
      }),
      inspectListeners: async (port) => {
        if (current === 'failed') throw new Error('controlled lsof failure');
        return current === 'missing'
          ? []
          : [...owned(101, port), ...owned(202, port)];
      },
      identifyProcess: async () => assert.fail('owner was not confirmed'),
    });
    assert.equal(result.found.length, 1);
    assert.equal(result.found[0].identity, undefined);
    assert.equal(result.found[0].observation, undefined);
  }
});

test('ownership rechecks bound concurrent port queries and cache metadata for a shared PID', async (t) => {
  const fixtures = await Promise.all(
    Array.from({ length: 10 }, () => pageFixture(t)),
  );
  let active = 0;
  let peak = 0;
  let reads = 0;
  let identities = 0;
  const result = await discover(
    -1,
    fixtures.map((fixture) => fixture.url),
    {
      inventory: async () => ({
        ports: [],
        listeners: fixtures.flatMap((fixture) => owned(101, fixture.port)),
        source: 'controlled ownership',
      }),
      inspectListeners: async (port) => {
        peak = Math.max(peak, ++active);
        reads++;
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return owned(101, port);
        } finally {
          active--;
        }
      },
      identifyProcess: async (pid) => {
        identities++;
        return metadata(pid);
      },
    },
  );
  assert.equal(result.found.length, 10);
  assert.equal(reads, 20);
  assert.ok(peak <= 8);
  assert.equal(identities, 1);
});

test('discovery stops adding ownership work after the existing soft time budget expires', async (t) => {
  const fixture = await pageFixture(t);
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  let reads = 0;
  const result = await discover(-1, [fixture.url], {
    inventory: async () => ({
      ports: [],
      listeners: owned(101, fixture.port),
      source: 'controlled ownership',
    }),
    inspectListeners: async (port) => {
      reads++;
      return owned(101, port);
    },
    identifyProcess: async (pid) => {
      clock += 15001;
      return metadata(pid);
    },
  });
  assert.equal(result.found.length, 1);
  assert.equal(result.found[0].identity, undefined);
  assert.equal(reads, 1, 'no extra lsof request after the soft budget expires');
  assert.equal(result.limited, true);
});

test('manual inspection compares listeners before the request, after the response, and after metadata', async (t) => {
  const fixture = await pageFixture(t);
  for (const phase of ['stable', 'response', 'metadata', 'ambiguous']) {
    let reads = 0;
    let identities = 0;
    const beforeRequests = fixture.requests.length;
    const result = await inspectUrl(fixture.url, {
      inspectListeners: async (port) => {
        assert.equal(port, fixture.port);
        reads++;
        if (reads === 1) {
          assert.equal(fixture.requests.length, beforeRequests);
          return phase === 'ambiguous'
            ? [...owned(101, port), ...owned(202, port)]
            : owned(101, port);
        }
        assert.equal(fixture.requests.length, beforeRequests + 1);
        return owned(
          (phase === 'response' && reads >= 2) ||
            (phase === 'metadata' && reads >= 3)
            ? 202
            : 101,
          port,
        );
      },
      identifyProcess: async (pid) => {
        assert.equal(reads, 2);
        identities++;
        return metadata(pid);
      },
    });
    assert.equal(result.title, 'Owned fixture page');
    if (phase === 'stable') {
      assert.equal(result.identity.key, 'fixture:101');
      assert.equal(result.observation, '101:fixture-start');
      assert.equal(reads, 3);
    } else {
      assert.equal(result.identity, undefined, phase);
      assert.equal(result.observation, undefined, phase);
    }
    assert.equal(identities, ['stable', 'metadata'].includes(phase) ? 1 : 0);
  }
});

const childSource = `
  const http = require('node:http');
  const server = http.createServer((request, response) => {
    if (request.url !== process.env.FIXTURE_ROUTE) {
      response.writeHead(404); response.end(); return;
    }
    response.writeHead(200, {'Content-Type': 'text/html'});
    response.end('<title>Owner ' + process.env.FIXTURE_OWNER + '</title>');
  });
  server.listen(Number(process.env.PORT), '127.0.0.1', () => {
    process.send({kind: 'ready', port: server.address().port});
  });
  process.on('message', (message) => {
    if (message === 'close-listener') server.close(() => process.send({kind: 'closed'}));
  });
`;

async function childMessage(child, kind) {
  let timer;
  let onMessage;
  let onError;
  let onExit;
  try {
    return await new Promise((resolve, reject) => {
      onMessage = (message) => {
        if (message?.kind === kind) resolve(message);
      };
      onError = reject;
      onExit = (code, signal) =>
        reject(
          new Error(`Owned fixture exited before ${kind}: ${code}/${signal}`),
        );
      child.on('message', onMessage);
      child.once('error', onError);
      child.once('exit', onExit);
      timer = setTimeout(
        () => reject(new Error(`Fixture ${kind} timeout`)),
        5000,
      );
    });
  } finally {
    clearTimeout(timer);
    child.off('message', onMessage);
    child.off('error', onError);
    child.off('exit', onExit);
  }
}

test(
  'real listener handoff never labels owner B HTML with the still-alive owner A directory',
  {
    skip:
      process.platform !== 'darwin' && 'real lsof/cwd coverage requires macOS',
    timeout: 15000,
  },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'locade-owner-race-'));
    const children = [];
    const report = {
      recordedAt: new Date().toISOString(),
      platform: process.platform,
      rootResponse: 404,
      discovery:
        'targeted real lsof snapshot of owned A, then handoff to owned B',
      nativeOrBrowserStarted: false,
      userProjectsRead: false,
      cleanupErrors: [],
    };
    t.after(async () => {
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        try {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null)
                child.kill('SIGKILL');
            }, 3000);
            child.once('exit', () => {
              clearTimeout(timer);
              resolve();
            });
            child.once('error', (error) => {
              clearTimeout(timer);
              reject(error);
            });
            child.kill('SIGTERM');
          });
        } catch (error) {
          report.cleanupErrors.push(error.message);
        }
      }
      await rm(root, { recursive: true, force: true });
      await mkdir('test-results', { recursive: true });
      await writeFile(
        'test-results/owner-discovery-race.json',
        `${JSON.stringify(report, null, 2)}\n`,
      );
      assert.deepEqual(report.cleanupErrors, []);
    });
    const route = `/${randomUUID()}`;
    async function launch(owner, port) {
      const directory = path.join(root, owner);
      await mkdir(directory);
      await writeFile(path.join(directory, 'package.json'), '{}');
      const env = {
        ...process.env,
        FIXTURE_ROUTE: route,
        FIXTURE_OWNER: owner,
        PORT: String(port),
      };
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      const child = spawn(process.execPath, ['-e', childSource], {
        cwd: directory,
        env,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      children.push(child);
      const ready = await childMessage(child, 'ready');
      return { child, port: ready.port };
    }
    const a = await launch('A', 0);
    let b;
    const result = await discover(-1, [`http://127.0.0.1:${a.port}${route}`], {
      inventory: async () => {
        const { stdout } = await exec(
          'lsof',
          ['-a', '-p', String(a.child.pid), '-iTCP', '-sTCP:LISTEN', '-Fpn'],
          { timeout: 1500, maxBuffer: 16384 },
        );
        const snapshot = parseListeners(stdout);
        assert.deepEqual(snapshot, owned(a.child.pid, a.port));
        const closed = childMessage(a.child, 'closed');
        a.child.send('close-listener');
        await closed;
        b = await launch('B', a.port);
        return {
          ports: [],
          listeners: snapshot,
          source: 'targeted own-PID lsof',
        };
      },
    });
    assert.equal(result.found.length, 1);
    const found = result.found[0];
    Object.assign(report, {
      previousPid: a.child.pid,
      currentPid: b.child.pid,
      formerOwnerStillAlive:
        a.child.exitCode === null && a.child.signalCode === null,
      actualTitle: found.title,
      attachedDirectory: found.identity?.directory || null,
      attachedObservation: found.observation || null,
      protected: !found.identity && !found.observation,
    });
    assert.equal(found.title, 'Owner B');
    assert.equal(found.identity, undefined);
    assert.equal(found.observation, undefined);
  },
);
