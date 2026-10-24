import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  stat,
  link,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store, LIBRARY_VERSION, validateLibrary } from '../server/store.js';
import { exportBackup, parseBackup, restoreBackup } from '../server/backup.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
  'base64',
);

async function fixture(t) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'locade-storage-restart-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.init();
  await store.transaction(async () => {
    const project = store.upsert({
      url: 'http://127.0.0.1:3000/',
      title: 'Saved fixture',
      observation: '101:owned',
    });
    project.name = 'My saved name';
    project.favorite = true;
    store.state.screenshotsEnabled = true;
    await store.stageScreenshot(project, (file) => writeFile(file, png));
  });
  return store;
}

const childSource = `
  import path from 'node:path';
  import * as fs from 'node:fs/promises';
  import { Store } from ${JSON.stringify(new URL('../server/store.js', import.meta.url).href)};
  import { exportBackup, parseBackup, restoreBackup } from ${JSON.stringify(new URL('../server/backup.js', import.meta.url).href)};
  const [directory, action, phase] = process.argv.slice(1);
  process.on('message', () => {});
  let armed = false;
  const pause = async () => {
    process.send({kind:'paused'});
    await new Promise(()=>{});
  };
  const store = new Store(directory, {io:{
    rename: async (from,to) => {
      if(armed && phase==='before-commit' && to===store.file) await pause();
      return fs.rename(from,to);
    },
    rm: async (file,options) => {
      if(armed && phase==='after-commit' && path.dirname(file)===store.screenshots) await pause();
      return fs.rm(file,options);
    },
    writeFile: async (file,data,options) => {
      const result = await fs.writeFile(file,data,options);
      if(armed && phase==='after-image' && path.dirname(file)===store.screenshots) await pause();
      return result;
    },
    link: async (from,to) => {
      await fs.link(from,to);
      if(action==='migrate') await pause();
    },
  }});
  await store.init();
  const archive = parseBackup(await exportBackup(store,true));
  const replacement = Buffer.concat([archive.images.values().next().value,Buffer.from('replacement')]);
  armed=true;
  if(action==='restore') await restoreBackup(store,archive,true);
  else await store.transaction(async()=>{
    const project=store.state.projects[0];
    if(action==='delete') {
      await store.deleteScreenshot(project);
      store.state.screenshotsEnabled=false;
    } else {
      await store.stageScreenshot(project,(file)=>store.io.writeFile(file,replacement));
    }
  });
  throw new Error('Expected interruption point was not reached');
`;

async function interruptAt(t, store, action, phase) {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', childSource, store.directory, action, phase],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const stopped = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
    await stopped;
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Owned fixture did not pause: ${stderr}`)),
        5000,
      );
      const onExit = () => {
        clearTimeout(timer);
        reject(new Error(`Owned fixture exited too early: ${stderr}`));
      };
      child.once('exit', onExit);
      child.once('error', reject);
      child.on('message', (message) => {
        if (message?.kind !== 'paused') return;
        clearTimeout(timer);
        child.off('exit', onExit);
        resolve();
      });
    });
  } finally {
    // Kill only the child handle created above, never a recorded or discovered PID.
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
  }
  const [code, signal] = await stopped;
  assert.equal(code, null);
  assert.equal(signal, 'SIGKILL');
}

for (const action of ['capture', 'restore', 'delete']) {
  for (const phase of ['after-image', 'before-commit', 'after-commit']) {
    if (action === 'delete' && phase === 'after-image') continue;
    test(
      `owned process interruption: ${action} / ${phase} recovers the committed library and collects only unreferenced images`,
      { timeout: 15000 },
      async (t) => {
        const store = await fixture(t);
        const original = structuredClone(store.state.projects[0]);
        const oldFile = store.screenshotPath(original);
        await interruptAt(t, store, action, phase);
        const disk = validateLibrary(
          JSON.parse(await readFile(store.file, 'utf8')),
        );
        const committed = phase === 'after-commit';
        if (!committed)
          assert.equal(
            disk.projects[0].screenshotRevision,
            original.screenshotRevision,
          );
        const restarted = new Store(store.directory);
        await restarted.init();
        const current = restarted.state.projects[0];
        assert.equal(current.name, original.name);
        assert.equal(current.favorite, true);
        assert.equal(restarted.snapshot().storageCleanupPending, false);
        if (committed && action === 'delete') {
          assert.equal(current.screenshot, null);
          assert.equal(restarted.state.screenshotsEnabled, false);
          assert.deepEqual(await readdir(restarted.screenshots), []);
        } else {
          const currentFile = restarted.screenshotPath(current);
          assert.deepEqual(await readdir(restarted.screenshots), [
            path.basename(currentFile),
          ]);
          assert.deepEqual(
            await readFile(currentFile),
            committed && action === 'capture'
              ? Buffer.concat([png, Buffer.from('replacement')])
              : png,
          );
          if (committed) {
            assert.notEqual(currentFile, oldFile);
            await assert.rejects(stat(oldFile), { code: 'ENOENT' });
          } else assert.equal(currentFile, oldFile);
        }
        if (action === 'restore' && committed)
          assert.notEqual(current.id, original.id);
        else assert.equal(current.id, original.id);
        const backup = parseBackup(await exportBackup(restarted, true));
        assert.equal(
          backup.images.size,
          committed && action === 'delete' ? 0 : 1,
        );
      },
    );
  }
}

test('a cleanup permission error remains explicit after restart and can be retried without restoring deleted consent', async (t) => {
  const store = await fixture(t);
  const file = store.screenshotPath(store.state.projects[0]);
  const failingRemove = async (target, options) => {
    if (target === file)
      throw Object.assign(new Error('injected cleanup EACCES'), {
        code: 'EACCES',
      });
    return rm(target, options);
  };
  store.io.rm = failingRemove;
  await store.transaction(async () => {
    store.state.screenshotsEnabled = false;
    await store.deleteScreenshot(store.state.projects[0]);
  });
  const restarted = new Store(store.directory, { io: { rm: failingRemove } });
  await restarted.init();
  assert.equal(restarted.snapshot().storageCleanupPending, true);
  assert.equal(restarted.snapshot().storageCleanupCode, 'EACCES');
  assert.equal(restarted.state.screenshotsEnabled, false);
  assert.equal(restarted.state.projects[0].screenshot, null);
  assert.equal(parseBackup(await exportBackup(restarted, true)).images.size, 0);
  restarted.io.rm = rm;
  await restarted.retryCleanup();
  assert.equal(restarted.snapshot().storageCleanupPending, false);
  assert.deepEqual(await readdir(restarted.screenshots), []);
});

test('v2 metadata migrates without renaming legacy covers, saves a metadata-only copy, and rejects unsafe revision fields', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'locade-storage-v2-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'screenshots'));
  const id = randomUUID();
  const original = {
    version: 2,
    screenshotsEnabled: true,
    autoRefresh: false,
    projects: [
      {
        id,
        name: 'Legacy cover',
        url: 'http://localhost:3000/',
        favorite: true,
        screenshot: '2026-10-23T00:00:00.000Z',
        captureAllowed: true,
      },
    ],
  };
  const bytes = JSON.stringify(original);
  const file = path.join(directory, 'screenshots', `${id}.png`);
  await writeFile(path.join(directory, 'library.json'), bytes);
  await writeFile(file, png);
  const store = new Store(directory);
  await store.init();
  assert.equal(store.state.version, LIBRARY_VERSION);
  assert.equal(store.state.projects[0].screenshotRevision, undefined);
  assert.equal(store.screenshotPath(store.state.projects[0]), file);
  assert.deepEqual(await readFile(file), png);
  assert.equal(
    await readFile(path.join(directory, 'library.v2.backup.json'), 'utf8'),
    bytes,
  );
  assert.deepEqual(await readdir(store.screenshots), [`${id}.png`]);
  const archive = parseBackup(await exportBackup(store, true));
  assert.equal(
    archive.state.version,
    2,
    'exported archives remain portable to the previous backup reader',
  );
  assert.equal(archive.state.projects[0].screenshotRevision, undefined);
  for (const revision of ['../private', null, 'x'.repeat(36)]) {
    const corrupt = structuredClone(store.state);
    corrupt.projects[0].screenshotRevision = revision;
    assert.throws(() => validateLibrary(corrupt));
  }
  const future = { ...original, version: LIBRARY_VERSION + 1 };
  await writeFile(store.file, JSON.stringify(future));
  await assert.rejects(new Store(directory).init(), /格式/);
  assert.deepEqual(await readFile(file), png);
});

test('partial migration backup failure is not accepted as a completed migration and never changes the original library', async (t) => {
  const store = await fixture(t);
  const original = structuredClone(store.state);
  original.version = 2;
  delete original.projects[0].screenshotRevision;
  // A valid legacy copy uses the legacy path, not a guessed revision.
  const legacyFile = path.join(
    store.screenshots,
    `${original.projects[0].id}.png`,
  );
  await writeFile(legacyFile, png);
  const bytes = JSON.stringify(original);
  await writeFile(store.file, bytes);
  const backup = path.join(store.directory, 'library.v2.backup.json');
  const broken = new Store(store.directory, {
    io: {
      writeFile: async (file, data, options) => {
        if (file === `${backup}.tmp`) {
          await writeFile(file, '{partial');
          throw Object.assign(new Error('migration ENOSPC'), {
            code: 'ENOSPC',
          });
        }
        return writeFile(file, data, options);
      },
    },
  });
  await assert.rejects(broken.init(), { code: 'ENOSPC' });
  assert.equal(await readFile(store.file, 'utf8'), bytes);
  assert.deepEqual(await readFile(legacyFile), png);
  await assert.rejects(stat(backup), { code: 'ENOENT' });
  const next = new Store(store.directory);
  await next.init();
  assert.equal(await readFile(backup, 'utf8'), bytes);
  assert.deepEqual(await readFile(legacyFile), png);
  await writeFile(store.file, bytes);
  await writeFile(backup, '{interrupted migration');
  await assert.rejects(new Store(store.directory).init());
  assert.equal(await readFile(store.file, 'utf8'), bytes);
  assert.deepEqual(await readFile(legacyFile), png);
});

async function legacyFixture(t) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'locade-migration-retry-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'screenshots'));
  const state = {
    version: 2,
    screenshotsEnabled: true,
    projects: [
      {
        id: randomUUID(),
        name: 'Preserved migration fixture',
        url: 'http://127.0.0.1:3000/',
        favorite: true,
        screenshot: '2026-10-24T00:00:00.000Z',
        captureAllowed: true,
      },
    ],
  };
  const file = path.join(directory, 'library.json');
  const backup = path.join(directory, 'library.v2.backup.json');
  const temporary = `${backup}.tmp`;
  const image = path.join(
    directory,
    'screenshots',
    `${state.projects[0].id}.png`,
  );
  const original = JSON.stringify(state);
  await writeFile(file, original, { mode: 0o600 });
  await writeFile(image, png, { mode: 0o600 });
  return { directory, state, file, backup, temporary, image, original };
}

test('migration retry never writes through a leftover hard link to an already published recovery copy', async (t) => {
  const s = await legacyFixture(t);
  await writeFile(s.backup, s.original, { mode: 0o600 });
  await link(s.backup, s.temporary);
  const changed = structuredClone(s.state);
  changed.projects[0].name = 'Later legacy edit stays in the live library';
  await writeFile(s.file, JSON.stringify(changed));
  let writes = 0;
  const store = new Store(s.directory, {
    io: {
      writeFile: async (file, data, options) => {
        if (file === s.temporary) {
          writes++;
          await writeFile(file, '{partial');
          throw Object.assign(new Error('injected migration retry EIO'), {
            code: 'EIO',
          });
        }
        return writeFile(file, data, options);
      },
    },
  });
  await store.init();
  assert.equal(
    writes,
    0,
    'an existing valid copy needs validation, not rewriting',
  );
  assert.equal(await readFile(s.backup, 'utf8'), s.original);
  assert.equal(store.state.projects[0].name, changed.projects[0].name);
  assert.equal((await stat(s.backup)).nlink, 1);
  await assert.rejects(stat(s.temporary), { code: 'ENOENT' });
  assert.deepEqual(await readFile(s.image), png);
});

test('a stale migration temp hard link is detached before a failed new copy can modify another file', async (t) => {
  const s = await legacyFixture(t);
  const other = path.join(s.directory, 'owned-unrelated-fixture.json');
  await writeFile(other, 'unrelated synthetic data');
  await link(other, s.temporary);
  const store = new Store(s.directory, {
    io: {
      writeFile: async (file, data, options) => {
        if (file === s.temporary) {
          await writeFile(file, '{partial');
          throw Object.assign(new Error('injected fresh migration ENOSPC'), {
            code: 'ENOSPC',
          });
        }
        return writeFile(file, data, options);
      },
    },
  });
  await assert.rejects(store.init(), { code: 'ENOSPC' });
  assert.equal(await readFile(other, 'utf8'), 'unrelated synthetic data');
  assert.equal(await readFile(s.file, 'utf8'), s.original);
  assert.deepEqual(await readFile(s.image), png);
  await assert.rejects(stat(s.backup), { code: 'ENOENT' });
  await assert.rejects(stat(s.temporary), { code: 'ENOENT' });
});

test('a damaged published migration copy is never silently repaired through a stale hard link', async (t) => {
  const s = await legacyFixture(t);
  const damaged = '{interrupted historical copy';
  await writeFile(s.backup, damaged);
  await link(s.backup, s.temporary);
  await assert.rejects(new Store(s.directory).init());
  assert.equal(await readFile(s.backup, 'utf8'), damaged);
  assert.equal(await readFile(s.file, 'utf8'), s.original);
  assert.deepEqual(await readFile(s.image), png);
});

test(
  'actual migration interruption after publishing the recovery copy resumes without rewriting it',
  { timeout: 15000 },
  async (t) => {
    const s = await legacyFixture(t);
    await interruptAt(t, { directory: s.directory }, 'migrate', 'after-link');
    assert.equal((await stat(s.backup)).ino, (await stat(s.temporary)).ino);
    assert.equal((await stat(s.backup)).nlink, 2);
    const store = new Store(s.directory, {
      io: {
        writeFile: async (file, data, options) => {
          assert.notEqual(
            file,
            s.temporary,
            'never truncate the already published recovery inode',
          );
          return writeFile(file, data, options);
        },
      },
    });
    await store.init();
    assert.equal(store.state.version, LIBRARY_VERSION);
    assert.equal(store.state.projects[0].id, s.state.projects[0].id);
    assert.equal(await readFile(s.backup, 'utf8'), s.original);
    assert.deepEqual(await readFile(s.image), png);
    await assert.rejects(stat(s.temporary), { code: 'ENOENT' });
  },
);
