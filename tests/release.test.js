import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  cp,
  readFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  releasePaths,
  assertReleaseDirectory,
  assertNewOutput,
  sourceManifest,
  verifyPackagedSources,
} from '../tools/macos-release.js';

test('candidate release paths are fixed, separated from approved artifacts and reject escapes', () => {
  const root = '/fixture/locade';
  const original = releasePaths(root, {});
  const candidate = releasePaths(root, {
    LOCADE_RELEASE_DIR: 'release/candidate-20261022',
  });
  assert.equal(original.app, '/fixture/locade/release/Locade.app');
  assert.equal(
    candidate.app,
    '/fixture/locade/release/candidate-20261022/Locade.app',
  );
  assert.notEqual(candidate.validationRoot, original.validationRoot);
  assert.notEqual(
    candidate.report('macos-runtime'),
    original.report('macos-runtime'),
  );
  assert.deepEqual(candidate, {
    ...releasePaths(root, { LOCADE_RELEASE_DIR: candidate.release }),
    report: candidate.report,
  });
  for (const bad of [
    '/',
    '../outside',
    '.build-cache/install-validation',
    'release/../outside',
    'release/candidate with spaces',
    'release/nested/next',
  ])
    assert.throws(() => releasePaths(root, { LOCADE_RELEASE_DIR: bad }));
});

test('release writers reject existing output and symlink directories without modifying them', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = releasePaths(root, { LOCADE_RELEASE_DIR: 'release/candidate' });
  await mkdir(paths.release, { recursive: true });
  await assertReleaseDirectory(paths);
  await assertNewOutput(paths.app);
  await mkdir(paths.app);
  await writeFile(path.join(paths.app, 'preserve'), 'approved identity');
  await assert.rejects(assertNewOutput(paths.app), /不覆盖/);
  assert.equal(
    await readFile(path.join(paths.app, 'preserve'), 'utf8'),
    'approved identity',
  );
  await symlink(paths.release, path.join(paths.base, 'alias'));
  await assert.rejects(
    assertReleaseDirectory(
      releasePaths(root, { LOCADE_RELEASE_DIR: 'release/alias' }),
    ),
    /链接/,
  );
});

test('source manifests are reproducible and packaged code tampering or extra files fail verification', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locade-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['macos', 'server', 'src', 'dist'])
    await mkdir(path.join(root, dir));
  for (const file of [
    'package.json',
    'package-lock.json',
    'macos/Locade.swift',
    'server/index.js',
    'src/main.jsx',
    'dist/index.html',
  ])
    await writeFile(path.join(root, file), file);
  const sources = await sourceManifest(root);
  assert.deepEqual(await sourceManifest(root), sources);
  const app = path.join(root, 'bundle/Locade.app');
  const runtime = path.join(app, 'Contents/Resources/Runtime');
  await mkdir(runtime, { recursive: true });
  for (const dir of ['server', 'dist'])
    await cp(path.join(root, dir), path.join(runtime, dir), {
      recursive: true,
    });
  assert.equal(await verifyPackagedSources(app, sources), 2);
  await writeFile(path.join(runtime, 'server/index.js'), 'changed');
  await assert.rejects(verifyPackagedSources(app, sources), /不一致/);
  await writeFile(path.join(runtime, 'server/index.js'), 'server/index.js');
  await writeFile(path.join(runtime, 'server/unexpected.js'), 'extra');
  await assert.rejects(verifyPackagedSources(app, sources), /不一致/);
  await writeFile(path.join(root, 'src/main.jsx'), 'new UI');
  assert.notEqual((await sourceManifest(root)).sha256, sources.sha256);
});

test('native project navigation uses the server gate rather than a stale discovered URL', async () => {
  const source = await readFile(
    new URL('../macos/Locade.swift', import.meta.url),
    'utf8',
  );
  const action = source.slice(
    source.indexOf('    func openProject('),
    source.indexOf('    func setLogin('),
  );
  assert.match(action, /UUID\(uuidString: project.id\)/);
  assert.match(action, /\/open\/\\\(project.id\)/);
  assert.doesNotMatch(action, /URL\(string: project.url\)|\/opened/);
});
