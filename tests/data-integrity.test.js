import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  chmod,
  stat,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { Store } from '../server/store.js';
import { exportBackup } from '../server/backup.js';
import { close, listen } from './helpers.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64',
);

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-integrity-'));
  let owner = '101:original';
  let captures = 0;
  let changeDuringCapture = false;
  let failCapture = false;
  const page = () => ({
    url: 'http://127.0.0.1:3000/',
    title: 'Identical title',
    observation: owner,
  });
  const app = await createApp({
    dataDir: directory,
    discoverProjects: async () => ({ found: [page()] }),
    inspectProject: async () => page(),
    capturePage: async (_url, file) => {
      await writeFile(file, Buffer.concat([png, Buffer.from(`${++captures}`)]));
      if (changeDuringCapture) owner = '202:replacement';
      if (failCapture) throw new Error('injected partial capture failure');
    },
    ...options,
  });
  const base = await listen(app.server);
  t.after(async () => {
    await close(app.server);
    await app.release();
    await chmod(directory, 0o700).catch(() => {});
    await chmod(app.store.screenshots, 0o700).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });
  const library = await (await fetch(`${base}/api/library`)).json();
  const api = (route, input = {}, method = 'POST', headers = {}) =>
    fetch(`${base}/api/${route}`, {
      method,
      headers: { 'X-Locade-Token': library.token, ...headers },
      body: Buffer.isBuffer(input) ? input : JSON.stringify(input),
    });
  const scanned = await (await api('scan')).json();
  const id = scanned.projects[0].id;
  assert.equal(
    (await api('settings', { screenshotsEnabled: true }, 'PATCH')).status,
    200,
  );
  assert.equal((await api(`projects/${id}/screenshot`)).status, 200);
  const cover = () => {
    const project = app.store.state.projects.find((item) => item.id === id);
    return (
      app.store.screenshotPath?.(project) ||
      path.join(app.store.screenshots, `${id}.png`)
    );
  };
  return {
    ...app,
    base,
    api,
    id,
    cover,
    swapDuringCapture: () => {
      changeDuringCapture = true;
    },
    failDuringCapture: () => {
      failCapture = true;
    },
  };
}

for (const [name, route, input, method] of [
  ['single cover deletion', (id) => `projects/${id}/screenshot`, {}, 'DELETE'],
  [
    'global privacy switch',
    () => 'settings',
    { screenshotsEnabled: false },
    'PATCH',
  ],
  ['recapture', (id) => `projects/${id}/screenshot`, {}, 'POST'],
  ['record deletion', (id) => `projects/${id}`, {}, 'DELETE'],
  ['all-cover deletion', () => 'screenshots', {}, 'DELETE'],
  [
    'per-project privacy switch',
    (id) => `projects/${id}`,
    { captureAllowed: false },
    'PATCH',
  ],
  ['directory unbinding', (id) => `projects/${id}/binding`, {}, 'DELETE'],
  [
    'directory binding',
    (id) => `projects/${id}/binding`,
    (s) => ({ directory: s.store.directory }),
    'POST',
  ],
]) {
  test(`${name}: failed metadata write preserves committed metadata and original PNG`, async (t) => {
    const s = await setup(t);
    const before = await readFile(s.store.file);
    const original = await readFile(s.cover());
    // A real, owned filesystem obstruction: image I/O still works, metadata does not.
    await mkdir(`${s.store.file}.tmp`);
    const response = await s.api(
      route(s.id),
      typeof input === 'function' ? input(s) : input,
      method,
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await readFile(s.store.file), before);
    assert.deepEqual(await readFile(s.cover()), original);
    await rm(`${s.store.file}.tmp`, { recursive: true });
    assert.equal(
      (await s.api('backup', { includeScreenshots: true })).status,
      200,
    );
  });
}

test('startup does not mistake a later ENOENT write failure for a missing library', async (t) => {
  const s = await setup(t);
  const before = await readFile(s.store.file);
  const restarted = new Store(s.store.directory);
  t.mock.method(restarted, 'save', async () => {
    throw Object.assign(new Error('injected missing metadata directory'), {
      code: 'ENOENT',
    });
  });
  await assert.rejects(restarted.init(), { code: 'ENOENT' });
  assert.deepEqual(await readFile(s.store.file), before);
});

test('metadata temporary files are made private even when an interrupted older file had broader permissions', async (t) => {
  const s = await setup(t);
  await writeFile(`${s.store.file}.tmp`, 'old metadata', { mode: 0o644 });
  await chmod(`${s.store.file}.tmp`, 0o644);
  assert.equal(
    (await s.api(`projects/${s.id}`, { favorite: true }, 'PATCH')).status,
    200,
  );
  assert.equal((await stat(s.store.file)).mode & 0o777, 0o600);
});

test('restoration does not report an uncommitted failure after metadata is already committed', async (t) => {
  const s = await setup(t);
  const archive = await exportBackup(s.store, true);
  t.mock.method(s.store, 'garbageCollect', async () => {
    throw Object.assign(new Error('injected cleanup permission failure'), {
      code: 'EACCES',
    });
  });
  const response = await s.api('restore', archive, 'POST', {
    'X-Locade-Confirm': 'replace-library',
    'X-Locade-Images': 'include',
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.notEqual(result.projects[0].id, s.id);
  assert.equal(result.storageCleanupPending, true);
});

test('a listener changed during capture cannot replace the original project cover', async (t) => {
  const s = await setup(t);
  const before = await readFile(s.store.file);
  const original = await readFile(s.cover());
  const files = await readdir(s.store.screenshots);
  s.swapDuringCapture();
  const response = await s.api(`projects/${s.id}/screenshot`);
  assert.equal(response.status, 400);
  assert.deepEqual(await readFile(s.store.file), before);
  assert.deepEqual(await readFile(s.cover()), original);
  assert.deepEqual(await readdir(s.store.screenshots), files);
});

test('an anonymous saved card still compares newly available owner evidence before and after capture', async (t) => {
  const s = await setup(t);
  await s.store.transaction(() => {
    for (const endpoint of s.store.state.projects[0].endpoints)
      endpoint.observation = null;
  });
  const before = await readFile(s.store.file);
  const file = s.cover();
  const pngBefore = await readFile(file);
  s.swapDuringCapture();
  assert.equal((await s.api(`projects/${s.id}/screenshot`)).status, 400);
  assert.deepEqual(await readFile(s.store.file), before);
  assert.deepEqual(await readFile(file), pngBefore);
  assert.deepEqual(await readdir(s.store.screenshots), [path.basename(file)]);
});

for (const code of ['ENOSPC', 'EACCES', 'EIO']) {
  for (const phase of ['partial-write', 'rename']) {
    test(`metadata ${phase} ${code}: rollback preserves images, removes temporary metadata, and permits retry`, async (t) => {
      const s = await setup(t);
      const before = await readFile(s.store.file);
      const cover = s.cover();
      const image = await readFile(cover);
      const io = s.store.io;
      const method = phase === 'partial-write' ? 'writeFile' : 'rename';
      const original = io[method];
      const fault = t.mock.method(io, method, async (file, ...args) => {
        if (file === `${s.store.file}.tmp`) {
          if (phase === 'partial-write')
            await writeFile(file, String(args[0]).slice(0, 17), {
              mode: 0o600,
            });
          throw Object.assign(new Error(`injected metadata ${code}`), { code });
        }
        return original(file, ...args);
      });
      const rejected = await s.api(`projects/${s.id}/screenshot`);
      assert.equal(rejected.status, 400);
      assert.match((await rejected.json()).error, new RegExp(code));
      assert.deepEqual(await readFile(s.store.file), before);
      assert.deepEqual(await readFile(cover), image);
      assert.deepEqual(await readdir(s.store.screenshots), [
        path.basename(cover),
      ]);
      await assert.rejects(stat(`${s.store.file}.tmp`), { code: 'ENOENT' });
      fault.mock.restore();
      assert.equal((await s.api(`projects/${s.id}/screenshot`)).status, 200);
      assert.notEqual(s.cover(), cover);
      await assert.rejects(stat(cover), { code: 'ENOENT' });
      assert.equal((await stat(s.cover())).mode & 0o777, 0o600);
    });
  }
}

test('partial capture and image permission failures clean only the new file and keep the old cover exportable', async (t) => {
  for (const phase of ['capture', 'chmod', 'sync']) {
    const s = await setup(t);
    const before = await readFile(s.store.file);
    const oldFile = s.cover();
    const image = await readFile(oldFile);
    if (phase === 'capture') s.failDuringCapture();
    if (phase === 'chmod') {
      t.mock.method(s.store.io, 'chmod', async (file, mode) => {
        if (path.dirname(file) === s.store.screenshots)
          throw Object.assign(new Error('injected image chmod EACCES'), {
            code: 'EACCES',
          });
        return chmod(file, mode);
      });
    }
    if (phase === 'sync') {
      const open = s.store.io.open;
      t.mock.method(s.store.io, 'open', async (file, flag, ...args) => {
        const handle = await open(file, flag, ...args);
        if (flag !== 'r') return handle;
        return {
          close: () => handle.close(),
          sync: async () => {
            throw Object.assign(new Error('injected image sync EIO'), {
              code: 'EIO',
            });
          },
        };
      });
    }
    assert.equal((await s.api(`projects/${s.id}/screenshot`)).status, 400);
    assert.deepEqual(await readFile(s.store.file), before);
    assert.deepEqual(await readFile(oldFile), image);
    assert.deepEqual(await readdir(s.store.screenshots), [
      path.basename(oldFile),
    ]);
    assert.equal(
      (await s.api('backup', { includeScreenshots: true })).status,
      200,
    );
  }
});

test('restore cleans partial images including a failure on the second image, then retries without touching originals', async (t) => {
  const s = await setup(t);
  await s.store.transaction(async () => {
    const second = s.store.upsert({
      url: 'http://127.0.0.1:3001/',
      title: 'Second owned fixture',
    });
    await s.store.stageScreenshot(second, (file) => writeFile(file, png));
  });
  const archive = await exportBackup(s.store, true);
  const before = await readFile(s.store.file);
  const originals = new Map(
    await Promise.all(
      (await readdir(s.store.screenshots)).map(async (file) => [
        file,
        await readFile(path.join(s.store.screenshots, file)),
      ]),
    ),
  );
  let writes = 0;
  const write = s.store.io.writeFile;
  const fault = t.mock.method(
    s.store.io,
    'writeFile',
    async (file, data, options) => {
      if (path.dirname(file) === s.store.screenshots && ++writes === 2) {
        await writeFile(file, data.subarray(0, 19));
        throw Object.assign(new Error('injected partial restore ENOSPC'), {
          code: 'ENOSPC',
        });
      }
      return write(file, data, options);
    },
  );
  const headers = {
    'X-Locade-Confirm': 'replace-library',
    'X-Locade-Images': 'include',
  };
  const rejected = await s.api('restore', archive, 'POST', headers);
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /ENOSPC/);
  assert.deepEqual(await readFile(s.store.file), before);
  assert.deepEqual(
    (await readdir(s.store.screenshots)).sort(),
    [...originals.keys()].sort(),
  );
  for (const [file, bytes] of originals)
    assert.deepEqual(
      await readFile(path.join(s.store.screenshots, file)),
      bytes,
    );
  fault.mock.restore();
  assert.equal((await s.api('restore', archive, 'POST', headers)).status, 200);
  assert.equal(s.store.state.projects.length, 2);
  for (const item of s.store.state.projects) {
    assert.ok(item.screenshotRevision);
    assert.ok(!originals.has(path.basename(s.store.screenshotPath(item))));
  }
  assert.equal((await readdir(s.store.screenshots)).length, 2);
});

test('a failed pre-restore checkpoint write preserves the previous checkpoint and the library with images', async (t) => {
  const s = await setup(t);
  const before = await readFile(s.store.file);
  const originalImage = await readFile(s.cover());
  const checkpoint = path.join(s.store.directory, 'before-restore.json');
  await s.store.metadataCheckpoint();
  const saved = await readFile(checkpoint);
  const write = s.store.io.writeFile;
  t.mock.method(s.store.io, 'writeFile', async (file, ...args) => {
    if (file === `${checkpoint}.tmp`) {
      await writeFile(file, '{partial');
      throw Object.assign(new Error('injected checkpoint EIO'), {
        code: 'EIO',
      });
    }
    return write(file, ...args);
  });
  const response = await s.api(
    'restore',
    await exportBackup(s.store, true),
    'POST',
    {
      'X-Locade-Confirm': 'replace-library',
      'X-Locade-Images': 'include',
    },
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await readFile(checkpoint), saved);
  assert.deepEqual(await readFile(s.store.file), before);
  assert.deepEqual(await readFile(s.cover()), originalImage);
  await assert.rejects(stat(`${checkpoint}.tmp`), { code: 'ENOENT' });
  const copy = JSON.parse(saved);
  assert.ok(
    copy.projects.every(
      (p) => p.screenshot === null && p.screenshotRevision === undefined,
    ),
  );
});

test('cleanup failure after an aborted write keeps the original failure and exposes a retryable unserved orphan', async (t) => {
  const s = await setup(t);
  const old = s.cover();
  const before = await readFile(s.store.file);
  const write = s.store.io.writeFile;
  const remove = s.store.io.rm;
  const writeFault = t.mock.method(
    s.store.io,
    'writeFile',
    async (file, ...args) => {
      if (file === `${s.store.file}.tmp`)
        throw Object.assign(new Error('primary ENOSPC'), { code: 'ENOSPC' });
      return write(file, ...args);
    },
  );
  const cleanupFault = t.mock.method(
    s.store.io,
    'rm',
    async (file, ...args) => {
      if (path.dirname(file) === s.store.screenshots && file !== old)
        throw Object.assign(new Error('secondary EACCES'), { code: 'EACCES' });
      return remove(file, ...args);
    },
  );
  const response = await s.api(`projects/${s.id}/screenshot`);
  assert.equal(response.status, 400);
  const failed = await response.json();
  assert.match(failed.error, /primary ENOSPC/);
  assert.equal(failed.library.storageCleanupPending, true);
  assert.equal(failed.library.storageCleanupCode, 'EACCES');
  assert.deepEqual(await readFile(s.store.file), before);
  const files = await readdir(s.store.screenshots);
  assert.equal(files.length, 2);
  const orphan = files.find((file) => file !== path.basename(old));
  assert.equal((await fetch(`${s.base}/screenshots/${orphan}`)).status, 404);
  writeFault.mock.restore();
  cleanupFault.mock.restore();
  const retried = await s.api('storage/cleanup');
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).storageCleanupPending, false);
  assert.deepEqual(await readdir(s.store.screenshots), [path.basename(old)]);
  assert.deepEqual(
    await readFile(s.store.file),
    before,
    'cleanup retries do not rewrite metadata',
  );
});

test(
  'real metadata directory permission loss rejects changes without deleting a cover',
  {
    skip:
      process.getuid?.() === 0 &&
      'permission denial requires an unprivileged user',
  },
  async (t) => {
    const s = await setup(t);
    const before = await readFile(s.store.file);
    const file = s.cover();
    const image = await readFile(file);
    t.after(() => chmod(s.store.directory, 0o700).catch(() => {}));
    await chmod(s.store.directory, 0o500);
    assert.equal(
      (await s.api(`projects/${s.id}/screenshot`, {}, 'DELETE')).status,
      400,
    );
    assert.deepEqual(await readFile(s.store.file), before);
    assert.deepEqual(await readFile(file), image);
    await chmod(s.store.directory, 0o700);
    assert.equal(
      (await s.api(`projects/${s.id}/screenshot`, {}, 'DELETE')).status,
      200,
    );
    await assert.rejects(stat(file), { code: 'ENOENT' });
  },
);

test(
  'real image-directory permission loss reports committed privacy settings and retries cleanup without another metadata write',
  {
    skip:
      process.getuid?.() === 0 &&
      'permission denial requires an unprivileged user',
  },
  async (t) => {
    const s = await setup(t);
    const file = s.cover();
    t.after(async () => {
      await chmod(s.store.directory, 0o700).catch(() => {});
      await chmod(s.store.screenshots, 0o700).catch(() => {});
    });
    await chmod(s.store.screenshots, 0o500);
    const response = await s.api(
      'settings',
      { screenshotsEnabled: false },
      'PATCH',
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.screenshotsEnabled, false);
    assert.equal(result.projects[0].screenshot, null);
    assert.equal(result.storageCleanupPending, true);
    assert.equal(result.storageCleanupCode, 'EACCES');
    assert.equal(
      (await fetch(`${s.base}/screenshots/${s.id}.png`)).status,
      404,
    );
    assert.ok(
      await stat(file),
      'the warning must not claim this file was removed',
    );
    const committed = await readFile(s.store.file);
    await chmod(s.store.screenshots, 0o700);
    await chmod(s.store.directory, 0o500);
    const retry = await s.api('storage/cleanup');
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).storageCleanupPending, false);
    assert.deepEqual(await readFile(s.store.file), committed);
    assert.deepEqual(await readdir(s.store.screenshots), []);
  },
);

test(
  'concurrent readers see only committed metadata and images, and a queued write survives a preceding failed commit',
  { timeout: 15000 },
  async (t) => {
    const s = await setup(t);
    const before = await (await fetch(`${s.base}/api/library`)).json();
    const image = await readFile(s.cover());
    let entered, unblock;
    const paused = new Promise((resolve) => {
      entered = resolve;
    });
    const released = new Promise((resolve) => {
      unblock = resolve;
    });
    t.after(() => unblock());
    const rename = s.store.io.rename;
    let once = true;
    t.mock.method(s.store.io, 'rename', async (from, to) => {
      if (to === s.store.file && once) {
        once = false;
        entered();
        await released;
        throw Object.assign(new Error('injected concurrent EIO'), {
          code: 'EIO',
        });
      }
      return rename(from, to);
    });
    const failed = s.api(
      `projects/${s.id}`,
      { name: 'Uncommitted name', captureAllowed: false },
      'PATCH',
    );
    await paused;
    let next;
    try {
      const during = await (await fetch(`${s.base}/api/library`)).json();
      assert.deepEqual(during.projects, before.projects);
      assert.deepEqual(
        Buffer.from(
          await (
            await fetch(`${s.base}/screenshots/${s.id}.png`)
          ).arrayBuffer(),
        ),
        image,
      );
      assert.equal(
        (await (await fetch(`${s.base}/api/storage`)).json()).count,
        1,
      );
      next = s.api(`projects/${s.id}`, { favorite: true }, 'PATCH');
    } finally {
      unblock();
    }
    assert.equal((await failed).status, 400);
    assert.equal((await next).status, 200);
    assert.equal(s.store.state.projects[0].name, before.projects[0].name);
    assert.equal(s.store.state.projects[0].favorite, true);
    assert.equal(s.store.state.projects[0].captureAllowed, true);
    assert.deepEqual(await readFile(s.cover()), image);
  },
);
