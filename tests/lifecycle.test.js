import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, close } from './helpers.js';
import { APP_VERSION } from '../server/version.js';

test(
  'CLI lifecycle: dynamic loopback port, exclusive instance, graceful shutdown and external project survival',
  { timeout: 20000 },
  async (t) => {
    const data = await mkdtemp(path.join(os.tmpdir(), 'locade-lifecycle-'));
    const external = await fixture();
    const children = [];
    t.after(async () => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGTERM');
          await exited;
        }
      }
      await close(external.server);
      await rm(data, { recursive: true, force: true });
    });
    const launch = () => {
      const child = spawn(process.execPath, ['server/index.js'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, PORT: '0', LOCADE_DATA_DIR: data },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.resume();
      child.stderr.resume();
      children.push(child);
      return child;
    };
    const first = launch();
    let record;
    for (let i = 0; i < 100; i++) {
      try {
        record = JSON.parse(
          await readFile(path.join(data, 'runtime.json'), 'utf8'),
        );
        break;
      } catch {
        if (first.exitCode !== null) assert.fail('server exited before ready');
        await delay(50);
      }
    }
    assert.ok(record?.port > 0);
    assert.equal(record.pid, first.pid);
    const base = `http://127.0.0.1:${record.port}`;
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.instance, record.instance);
    assert.equal(health.version, APP_VERSION);
    const library = await (await fetch(`${base}/api/library`)).json();
    assert.equal(library.appVersion, APP_VERSION);
    const added = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'X-Locade-Token': library.token },
      body: JSON.stringify({ url: external.url }),
    });
    assert.equal(added.status, 200);
    const duplicate = launch();
    const [duplicateCode] = await once(duplicate, 'exit');
    assert.notEqual(duplicateCode, 0);
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    const ended = once(first, 'exit');
    first.kill('SIGTERM');
    const [code, signal] = await ended;
    assert.equal(code, 0);
    assert.equal(signal, null);
    await assert.rejects(access(path.join(data, 'instance.lock')));
    await assert.rejects(access(path.join(data, 'runtime.json')));
    const saved = JSON.parse(
      await readFile(path.join(data, 'library.json'), 'utf8'),
    );
    assert.equal(saved.projects.length, 1);
    assert.equal((await fetch(external.url)).status, 200);
  },
);
