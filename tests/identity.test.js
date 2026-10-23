import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  directoryIdentity,
  detectDirectory,
  parseListeners,
  processIdentity,
} from '../server/identity.js';
import { Store, LIBRARY_VERSION } from '../server/store.js';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'repo', 'apps', 'web');
  const other = path.join(root, 'repo', 'apps', 'admin');
  await mkdir(path.join(root, 'repo', '.git'), { recursive: true });
  await writeFile(
    path.join(root, 'repo', '.git', 'HEAD'),
    'ref: refs/heads/main\n',
  );
  for (const directory of [app, other]) {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), '{}');
  }
  return { root, app, other };
}

test('identities use nearest app root, preserve monorepo/worktree separation, resolve aliases and read Git without executing it', async (t) => {
  const { root, app, other } = await setup(t);
  await mkdir(path.join(app, 'src'));
  const identity = await detectDirectory(path.join(app, 'src'));
  assert.equal(
    identity.directory,
    await import('node:fs/promises').then((fs) => fs.realpath(app)),
  );
  assert.equal(identity.branch, 'main');
  assert.notEqual(identity.key, (await directoryIdentity(other)).key);
  const worktree = path.join(root, 'worktree');
  const gitDir = path.join(root, 'repo', '.git', 'worktrees', 'feature');
  await mkdir(gitDir, { recursive: true });
  await mkdir(worktree);
  await writeFile(path.join(worktree, '.git'), `gitdir: ${gitDir}\n`);
  await writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature/a\n');
  const linked = await directoryIdentity(worktree);
  assert.equal(linked.branch, 'feature/a');
  assert.notEqual(linked.key, identity.key);
  await writeFile(path.join(gitDir, 'HEAD'), 'a'.repeat(40));
  assert.equal((await directoryIdentity(worktree)).branch, 'detached:aaaaaaaa');
  await symlink(app, path.join(root, 'alias'));
  assert.equal(
    (await directoryIdentity(path.join(root, 'alias'))).key,
    identity.key,
  );
  await assert.rejects(directoryIdentity('/'));
  await assert.rejects(directoryIdentity('relative'));
});

test('port/PID parser and actual current-process metadata are read-only', async () => {
  assert.deepEqual(
    parseListeners('p12\nf1\nn*:3000\nf2\nn[::1]:3000\np13\nn127.0.0.1:3000\n'),
    [
      { pid: 12, port: 3000 },
      { pid: 13, port: 3000 },
    ],
  );
  const current = await processIdentity(process.pid);
  if (process.platform === 'darwin') {
    assert.ok(current.observation?.startsWith(`${process.pid}:`));
    assert.ok(current.identity);
  }
  assert.deepEqual(await processIdentity(-1), {
    identity: null,
    observation: null,
  });
});

test('project identity survives port changes but never transfers covers/favorites across reused ports', async (t) => {
  const { root, app, other } = await setup(t);
  const store = new Store(path.join(root, 'data'));
  await store.init();
  const a = await directoryIdentity(app, 'auto');
  const b = await directoryIdentity(other, 'auto');
  const first = store.upsert({
    url: 'http://127.0.0.1:3000/',
    title: 'Same Title',
    identity: a,
    observation: '1:first',
  });
  first.favorite = true;
  first.screenshot = new Date().toISOString();
  first.online = false;
  const moved = store.upsert({
    url: 'http://127.0.0.1:3001/',
    title: 'Same Title',
    identity: a,
    observation: '2:second',
  });
  assert.equal(moved.id, first.id);
  assert.equal(moved.favorite, true);
  assert.ok(moved.screenshot);
  assert.equal(moved.endpoints.length, 2);
  const reused = store.upsert({
    url: 'http://127.0.0.1:3000/',
    title: 'Same Title',
    identity: b,
    observation: '3:third',
  });
  assert.notEqual(reused.id, first.id);
  assert.equal(reused.favorite, false);
  assert.equal(reused.screenshot, null);
  const uncertain = store.upsert({
    url: 'http://127.0.0.1:3000/',
    title: 'Same Title',
    observation: '4:fourth',
  });
  assert.notEqual(uncertain.id, reused.id);
  const page = store.upsert({
    url: 'http://127.0.0.1:3001/docs',
    title: 'Docs',
    identity: a,
    observation: '2:second',
  });
  assert.notEqual(page.id, first.id);
});

test('v1 migration preserves user records, retains a recovery copy, and does not guess identity', async (t) => {
  const { root } = await setup(t);
  const directory = path.join(root, 'data');
  await mkdir(directory);
  const original = {
    version: 1,
    screenshotsEnabled: false,
    projects: [
      {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        name: 'Old',
        url: 'http://localhost:3000/',
        favorite: true,
        screenshot: null,
      },
    ],
  };
  await writeFile(
    path.join(directory, 'library.json'),
    JSON.stringify(original),
  );
  const store = new Store(directory);
  await store.init();
  assert.equal(store.state.version, LIBRARY_VERSION);
  assert.equal(store.state.projects[0].favorite, true);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, 'library.v1.backup.json'))),
    original,
  );
  const next = store.upsert({
    url: 'http://localhost:3000/',
    title: 'Old',
    observation: 'new',
  });
  assert.notEqual(next.id, original.projects[0].id);
});

test('concurrent HTML services sharing an app directory stay separate across reordered scans', async (t) => {
  const { root, app } = await setup(t);
  const store = new Store(path.join(root, 'data'));
  await store.init();
  const identity = await directoryIdentity(app, 'auto');
  const web = {
    url: 'http://127.0.0.1:3000/',
    title: 'Web',
    identity,
    observation: '1:date',
  };
  const docs = {
    url: 'http://127.0.0.1:6006/',
    title: 'Storybook',
    identity,
    observation: '2:date',
  };
  const first = store.upsert(web);
  first.favorite = true;
  const second = store.upsert(docs);
  assert.notEqual(first.id, second.id);
  for (const item of store.state.projects) item.online = false;
  assert.equal(store.upsert(docs).id, second.id);
  assert.equal(store.upsert(web).id, first.id);
  assert.equal(store.state.projects.length, 2);
});
