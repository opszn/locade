import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { acquireInstance } from '../server/instance.js';
import { releasePaths, assertReleaseDirectory } from './macos-release.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const paths = releasePaths(root);
await assertReleaseDirectory(paths);
const prepareOnly = process.argv.includes('--prepare-only');
const refresh = process.argv.includes('--refresh');
const exerciseReplacement = process.argv.includes('--exercise-replacement');
const reportFile = paths.report(
  prepareOnly ? 'macos-install-prepare' : 'macos-install',
);
const metadata = JSON.parse(await readFile(path.join(root, 'package.json')));
const dmg = path.join(
  paths.release,
  `Locade-${metadata.version}-${process.arch}.dmg`,
);
const results = [];
const skipNative = process.argv.includes('--skip-native');
const validationRoot = paths.validationRoot;
const applications = path.join(validationRoot, 'Applications With Spaces');
const target = path.join(applications, 'Locade.app');
const staged = path.join(applications, 'Locade Replacement.app');
const retired = path.join(applications, 'Locade Previous.app');
const preparedFile = path.join(validationRoot, 'prepared.json');
const ownerFile = path.join(validationRoot, '.locade-install-owner.json');
const inspectionFile = path.join(validationRoot, 'needs-inspection.json');
const limitations = [
  '应用在项目内固定测试路径，资料库 / HOME / TMP 在临时目录；未写真实 /Applications 或 ~/.locade。',
  '替换使用同一构建，验证资料与截图保留，不等同于跨版本迁移或自动更新。',
  '未验证干净机器、其他 macOS 版本 / 架构、Finder 拖拽或 Gatekeeper 首次下载体验。',
  '未注册或测试真实登录项；不修改签名、扩展属性或系统进程管控策略。',
  '原生烟测验证启动与退出；不替代完整菜单栏视觉交互验收。',
];
const children = new Set();
let sandbox;
let mountPoint;
let mounted = false;
let data;
let sourceKind;
let sourceVersion;
let fixture;
let activeStep = 'prerequisites';
let safeToRemove = true;
let nativeAvailable = false;
let releaseLock;
let sourceFingerprint;
let originalRetired = false;
let targetPrepared = false;
let preparedWasReused = false;
let originalInode;
let originalExecutableInode;
let requiresInspection = false;
let executionPerformed = false;

const exists = async (file) => {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};
const digest = (value) => createHash('sha256').update(value).digest('hex');
const record = (test, details = {}) => {
  results.push({ test, status: 'passed', passed: true, ...details });
  console.log(`✓ ${test}`);
};
const failure = (test, error) => {
  results.push({
    test,
    status: 'failed',
    passed: false,
    reason: error.message,
    signal: error.signal || null,
    timedOut: error.killed === true,
    reachedReadiness: error.reachedReadiness === true,
  });
  console.error(`✗ ${test}: ${error.message}`);
  process.exitCode = 1;
};
const skip = (test, reason) => {
  results.push({ test, status: 'skipped', passed: null, reason });
  console.log(`- ${test}: ${reason}`);
};
const quiet = async () => {
  for (let attempt = 0; attempt < 700; attempt++) {
    if (
      !(await exists(path.join(data, 'instance.lock'))) &&
      !(await exists(path.join(data, 'runtime.json')))
    )
      return;
    await delay(50);
  }
  safeToRemove = false;
  requiresInspection = true;
  throw Object.assign(
    new Error('测试资料库仍有后台运行记录，保留隔离目录，不删除运行中资源'),
    { cleanupUnsafe: true },
  );
};
const runtimeAt = (app) => path.join(app, 'Contents/Resources/Runtime');
const environment = () => ({
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
  HOME: path.join(sandbox, 'Isolated Home'),
  TMPDIR: path.join(sandbox, 'Temporary Files'),
  LOCADE_DATA_DIR: data,
});

async function regular(file, kind, optional = false) {
  let entry;
  try {
    entry = await lstat(file);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return false;
    throw error;
  }
  assert.equal(entry.isSymbolicLink(), false, `拒绝符号链接：${file}`);
  assert.ok(
    kind === 'directory' ? entry.isDirectory() : entry.isFile(),
    `测试路径类型不符：${file}`,
  );
  return true;
}

async function fingerprint(bundle) {
  const hash = createHash('sha256');
  async function walk(relative = '') {
    for (const name of (await readdir(path.join(bundle, relative))).sort()) {
      const member = path.join(relative, name);
      const file = path.join(bundle, member);
      const entry = await lstat(file);
      if (entry.isDirectory()) {
        hash.update(JSON.stringify([member, 'directory', entry.mode & 0o777]));
        await walk(member);
      } else if (entry.isFile()) {
        hash.update(
          JSON.stringify([member, 'file', entry.mode & 0o777, entry.size]),
        );
        for await (const chunk of createReadStream(file)) hash.update(chunk);
      } else if (entry.isSymbolicLink()) {
        const link = await readlink(file);
        const destination = path.resolve(path.dirname(file), link);
        assert.ok(
          destination.startsWith(`${bundle}${path.sep}`),
          '应用包不得包含指向包外的符号链接',
        );
        hash.update(JSON.stringify([member, 'symlink', link]));
      } else throw new Error('应用包包含未支持的文件类型');
    }
  }
  await regular(bundle, 'directory');
  await walk();
  return hash.digest('hex');
}

async function acquireValidationDirectory() {
  for (const flag of process.argv.slice(2))
    assert.ok(
      [
        '--prepare-only',
        '--refresh',
        '--skip-native',
        '--exercise-replacement',
      ].includes(flag),
      `未知参数：${flag}`,
    );
  assert.ok(
    !refresh || prepareOnly,
    '--refresh 只允许与 --prepare-only 一起使用',
  );
  assert.ok(
    !(exerciseReplacement && prepareOnly),
    '--exercise-replacement 不与 --prepare-only 混用',
  );
  await mkdir(path.dirname(validationRoot), { recursive: true });
  await regular(path.dirname(validationRoot), 'directory');
  let created = false;
  try {
    await mkdir(validationRoot, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await regular(validationRoot, 'directory');
  const project = await realpath(root);
  if (created)
    await writeFile(
      ownerFile,
      JSON.stringify({
        version: 1,
        tool: 'locade-install-validation',
        project,
      }),
      { flag: 'wx', mode: 0o600 },
    );
  await regular(ownerFile, 'file');
  assert.deepEqual(
    JSON.parse(await readFile(ownerFile)),
    {
      version: 1,
      tool: 'locade-install-validation',
      project,
    },
    '固定目录不属于此测试；不覆盖、不删除',
  );
  await regular(path.join(validationRoot, 'instance.lock'), 'file', true);
  releaseLock = await acquireInstance(validationRoot);
  const inspectionRequired = await exists(inspectionFile);
  if (inspectionRequired) requiresInspection = true;
  assert.equal(
    inspectionRequired,
    false,
    '上次测试资源状态不确定；请先人工检查 needs-inspection.json，不继续 prepare / refresh',
  );
  const permitted = new Set([
    path.basename(ownerFile),
    'instance.lock',
    path.basename(preparedFile),
    path.basename(applications),
  ]);
  for (const name of await readdir(validationRoot))
    assert.ok(permitted.has(name), `固定测试目录含未知文件，不做覆盖：${name}`);
  await mkdir(applications, { recursive: true, mode: 0o700 });
  await regular(applications, 'directory');
  for (const name of await readdir(applications))
    assert.equal(
      name,
      'Locade.app',
      '有残留或未知应用；先人工检查，不自动删除',
    );
  await regular(target, 'directory', true);
  await regular(preparedFile, 'file', true);
}

async function copyVerified(source, destination) {
  assert.equal(await exists(destination), false, '拒绝覆盖已有应用副本');
  await exec('/usr/bin/ditto', [source, destination], { timeout: 120000 });
  await exec('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    destination,
  ]);
  assert.equal(await fingerprint(destination), sourceFingerprint);
}

async function assertNotRunning(bundle) {
  assert.equal(children.size, 0, '仍有测试自有进程，不更换或移除应用资源');
  assert.equal(
    requiresInspection,
    false,
    '清理状态不确定，不更换或移除应用资源',
  );
  if (data) await quiet();
  const executables = [
    path.join(bundle, 'Contents/MacOS/Locade'),
    path.join(runtimeAt(bundle), 'node'),
    path.join(runtimeAt(bundle), 'browser/chrome-headless-shell'),
  ];
  try {
    const { stdout } = await exec(
      '/usr/sbin/lsof',
      ['-t', '--', ...executables],
      {
        timeout: 10000,
      },
    );
    assert.equal(stdout.trim(), '', '应用仍被进程使用；请先退出，不自动停止它');
  } catch (error) {
    if (
      error.code === 1 &&
      !error.stdout?.trim() &&
      !error.stderr?.trim() &&
      !error.killed
    )
      return;
    throw error;
  }
}

async function removeVerified(bundle, expected = sourceFingerprint) {
  assert.ok([target, staged, retired].includes(bundle));
  await regular(bundle, 'directory');
  assert.equal(await fingerprint(bundle), expected, '副本被外部修改，不删除');
  await assertNotRunning(bundle);
  await rm(bundle, { recursive: true });
}

async function prepare(source) {
  sourceFingerprint = await fingerprint(source);
  if (await exists(target)) {
    await regular(preparedFile, 'file');
    const prepared = JSON.parse(await readFile(preparedFile));
    assert.equal(prepared.tool, 'locade-install-validation');
    assert.equal(prepared.target, target);
    const actual = await fingerprint(target);
    assert.equal(actual, prepared.fingerprint, '已准备副本被修改，不静默覆盖');
    if (actual !== sourceFingerprint) {
      assert.ok(
        refresh,
        '源构建已变更；先显式 --prepare-only --refresh，并重新确认路径放行',
      );
      console.log(
        '显式刷新测试副本：会更换二进制，已有路径放行可能需要重新确认。',
      );
      await copyVerified(source, staged);
      await assertNotRunning(target);
      await rename(target, retired);
      try {
        await rename(staged, target);
      } catch (error) {
        await rename(retired, target);
        throw error;
      }
      await removeVerified(retired, actual);
    } else {
      assert.equal(prepared.version, sourceVersion);
      preparedWasReused = true;
    }
  } else {
    assert.equal(
      await exists(preparedFile),
      false,
      '准备记录存在但副本缺失，请先人工检查',
    );
    await copyVerified(source, target);
  }
  if (!preparedWasReused)
    await writeFile(
      preparedFile,
      JSON.stringify({
        tool: 'locade-install-validation',
        target,
        version: sourceVersion,
        fingerprint: sourceFingerprint,
      }),
      { mode: 0o600 },
    );
  targetPrepared = true;
}

async function probeMount() {
  const { stdout } = await exec('/sbin/mount', [], { timeout: 10000 });
  const canonical = await realpath(mountPoint);
  return stdout
    .split('\n')
    .some((line) =>
      [mountPoint, canonical].some((directory) =>
        line.includes(` on ${directory} (`),
      ),
    );
}

function launch(executable, args, options) {
  executionPerformed = true;
  const child = spawn(executable, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-8192);
  });
  child.stderr.on('data', (chunk) => {
    output = `${output}${chunk}`.slice(-8192);
  });
  const ended = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const managed = { child, ended, output: () => output };
  children.add(managed);
  return managed;
}

async function finish(managed, terminate = false, timeout = 35000) {
  if (
    terminate &&
    managed.child.exitCode === null &&
    managed.child.signalCode === null
  )
    managed.child.kill('SIGTERM');
  const timer = new AbortController();
  let ended;
  try {
    ended = await Promise.race([
      managed.ended,
      delay(timeout, null, { signal: timer.signal }).then(() => {
        safeToRemove = false;
        requiresInspection = true;
        throw Object.assign(new Error('测试自有进程退出超时'), {
          cleanupUnsafe: true,
          killed: true,
        });
      }),
    ]);
  } finally {
    timer.abort();
  }
  children.delete(managed);
  if (ended.error) throw ended.error;
  return ended;
}

async function smoke(app, expectedProjects) {
  const managed = launch(
    path.join(app, 'Contents/MacOS/Locade'),
    ['--smoke-test', '--no-discovery'],
    { env: { ...process.env, ...environment() } },
  );
  try {
    const ended = await finish(managed, false, 45000);
    if (ended.code !== 0 || ended.signal)
      throw Object.assign(
        new Error(
          `复制后的原生应用退出：code=${ended.code} signal=${ended.signal || 'none'}`,
        ),
        {
          signal: ended.signal,
          reachedReadiness: /LOCADE_SMOKE_OK/.test(managed.output()),
        },
      );
    assert.match(
      managed.output(),
      new RegExp(
        `LOCADE_SMOKE_OK .*owns=true projects=${expectedProjects}(?:\\s|$)`,
      ),
    );
  } finally {
    try {
      if (children.has(managed)) await finish(managed, true);
      await quiet();
    } catch (error) {
      safeToRemove = false;
      requiresInspection = true;
      error.cleanupUnsafe = true;
      throw error;
    }
  }
}

async function startInstalledCore(app) {
  const runtime = runtimeAt(app);
  const managed = launch(path.join(runtime, 'node'), ['server/index.js'], {
    cwd: runtime,
    env: {
      ...environment(),
      PORT: '0',
      LOCADE_PARENT_PID: String(process.pid),
      LOCADE_BROWSER_EXECUTABLE: path.join(
        runtime,
        'browser/chrome-headless-shell',
      ),
    },
  });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (managed.child.exitCode !== null || managed.child.signalCode !== null)
      throw new Error(`复制后的内置服务未就绪：${managed.output()}`);
    try {
      const record = JSON.parse(
        await readFile(path.join(data, 'runtime.json'), 'utf8'),
      );
      assert.equal(record.pid, managed.child.pid);
      const base = `http://127.0.0.1:${record.port}`;
      const health = await (
        await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })
      ).json();
      assert.equal(health.instance, record.instance);
      assert.equal(health.version, sourceVersion);
      return { managed, base };
    } catch (error) {
      if (error.code !== 'ENOENT' && attempt > 50) throw error;
      await delay(50);
    }
  }
  throw new Error('复制后的内置服务就绪超时');
}

async function api(base, route, method = 'GET', body) {
  const library = await (
    await fetch(`${base}/api/library`, { signal: AbortSignal.timeout(3000) })
  ).json();
  const response = await fetch(`${base}/api/${route}`, {
    method,
    headers: { 'X-Locade-Token': library.token },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, `${method} ${route}`);
  return response.json();
}

async function stopCore(managed) {
  const ended = await finish(managed, true);
  assert.equal(ended.code, 0);
  assert.equal(ended.signal, null);
  await quiet();
}

async function signingMetadata(file) {
  const { stderr } = await exec('/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    file,
  ]);
  const { stdout } = await exec('/usr/bin/xattr', [file]);
  return {
    cdHash: stderr.match(/^CDHash=(.*)$/m)?.[1] || null,
    signature: stderr.match(/^Signature=(.*)$/m)?.[1] || null,
    extendedAttributeNames: stdout.trim().split('\n').filter(Boolean).sort(),
  };
}

try {
  assert.equal(process.platform, 'darwin', '安装验收需要 macOS');
  activeStep = 'owned-fixed-directory';
  await acquireValidationDirectory();
  record(activeStep);
  sandbox = await mkdtemp(path.join(os.tmpdir(), 'locade-install-'));
  data = path.join(sandbox, 'User Data', 'Locade Library');
  for (const directory of [
    data,
    path.join(sandbox, 'Isolated Home'),
    path.join(sandbox, 'Temporary Files'),
  ])
    await mkdir(directory, { recursive: true, mode: 0o700 });

  let source = paths.app;
  activeStep = 'readonly-distribution-source';
  if (await exists(dmg)) {
    await exec('/usr/bin/hdiutil', ['verify', dmg], { timeout: 120000 });
    mountPoint = path.join(sandbox, 'Read Only Distribution');
    await mkdir(mountPoint);
    await exec(
      '/usr/bin/hdiutil',
      ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPoint, dmg],
      { timeout: 60000 },
    );
    mounted = true;
    source = path.join(mountPoint, 'Locade.app');
    sourceKind = 'verified-dmg-readonly';
  } else {
    sourceKind = 'release-app';
    limitations.push(
      '本次未发现 DMG，只使用 release/Locade.app 验证应用复制。',
    );
  }
  sourceVersion = JSON.parse(
    await readFile(path.join(source, 'Contents/Resources/BUILD.json')),
  ).version;
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', source]);
  record(activeStep, { sourceKind, version: sourceVersion });

  activeStep = 'prepare-fixed-path-with-spaces';
  await prepare(source);
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', target]);
  originalInode = (await stat(target)).ino;
  originalExecutableInode = (
    await stat(path.join(target, 'Contents/MacOS/Locade'))
  ).ino;
  const sourceBinary = digest(
    await readFile(path.join(source, 'Contents/MacOS/Locade')),
  );
  assert.equal(
    digest(await readFile(path.join(target, 'Contents/MacOS/Locade'))),
    sourceBinary,
  );
  const sourceSigning = await signingMetadata(
    path.join(source, 'Contents/MacOS/Locade'),
  );
  const copiedSigning = await signingMetadata(
    path.join(target, 'Contents/MacOS/Locade'),
  );
  assert.equal(copiedSigning.cdHash, sourceSigning.cdHash);
  record(activeStep, {
    reused: preparedWasReused,
    target,
    bundleSHA256: sourceFingerprint,
    bundleInode: originalInode,
    executableInode: originalExecutableInode,
    signatureIntegrity: true,
    sourceSigning,
    copiedSigning,
  });
  if (prepareOnly) {
    skip(
      'runtime-and-installation-tests',
      '--prepare-only：仅准备副本，不启动任何待测二进制',
    );
  } else {
    activeStep = 'copied-native-startup';
    if (skipNative) {
      skip(activeStep, '--skip-native：不重复执行此前已失败的复制路径原生启动');
    } else {
      try {
        await smoke(target, 0);
        nativeAvailable = true;
        record(activeStep);
      } catch (error) {
        if (error.cleanupUnsafe) throw error;
        failure(activeStep, error);
        limitations.push(
          '复制路径的原生启动未通过，后续不重复尝试同一阻拦；数据验收仍独立尝试内置核心。',
        );
      }
    }

    activeStep = 'installed-api';
    fixture = http.createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(
        '<!doctype html><html><head><title>Install Sandbox</title></head><body style="background:#f4f1e9;color:#252722"><h1>Retain this local project</h1></body></html>',
      );
    });
    fixture.listen(0, '127.0.0.1');
    await once(fixture, 'listening');
    const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;
    const installed = await startInstalledCore(target);
    const html = await (
      await fetch(installed.base, { signal: AbortSignal.timeout(3000) })
    ).text();
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(asset, '复制后的应用需要提供真实 Web 入口与构建脚本');
    assert.equal(
      (
        await fetch(new URL(asset, installed.base), {
          signal: AbortSignal.timeout(3000),
        })
      ).status,
      200,
    );
    let library = await api(installed.base, 'projects', 'POST', {
      url: fixtureUrl,
    });
    assert.equal(library.projects.length, 1);
    const id = library.projects[0].id;
    await api(installed.base, `projects/${id}`, 'PATCH', {
      name: 'Retained Sandbox Project',
      favorite: true,
    });
    await api(installed.base, `projects/${id}/opened`, 'POST');
    await api(installed.base, 'settings', 'PATCH', {
      autoRefresh: false,
      screenshotsEnabled: true,
    });
    record(activeStep, { projectCount: 1, webEntrypointServed: true });
    activeStep = 'installed-bundled-screenshot';
    let imageFile;
    let imageHash;
    try {
      library = await api(installed.base, `projects/${id}/screenshot`, 'POST');
      assert.ok(library.projects[0].screenshot);
      const image = Buffer.from(
        await (
          await fetch(`${installed.base}/screenshots/${id}.png`, {
            signal: AbortSignal.timeout(3000),
          })
        ).arrayBuffer(),
      );
      assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      imageFile = path.join(data, 'screenshots', `${id}.png`);
      imageHash = digest(image);
      assert.equal(digest(await readFile(imageFile)), imageHash);
      record(activeStep, { screenshotBytes: image.length });
    } catch (error) {
      failure(activeStep, error);
    }
    await stopCore(installed.managed);

    if (!exerciseReplacement) {
      activeStep = 'fixed-copy-restart-retains-data';
      const beforeRestart = JSON.parse(
        await readFile(path.join(data, 'library.json')),
      );
      if (nativeAvailable) await smoke(target, 1);
      else
        skip(
          'fixed-copy-native-restart',
          '原生烟测未通过或被显式跳过，不再重试',
        );
      const restarted = await startInstalledCore(target);
      library = await api(restarted.base, 'library');
      assert.equal(library.projects[0].id, id);
      assert.equal(library.projects[0].name, 'Retained Sandbox Project');
      assert.equal(library.projects[0].favorite, true);
      assert.equal(
        library.projects[0].lastOpened,
        beforeRestart.projects[0].lastOpened,
      );
      assert.equal(library.screenshotsEnabled, true);
      assert.equal(library.autoRefresh, false);
      if (imageFile) {
        assert.equal(digest(await readFile(imageFile)), imageHash);
        assert.equal(
          digest(
            Buffer.from(
              await (
                await fetch(`${restarted.base}/screenshots/${id}.png`, {
                  signal: AbortSignal.timeout(3000),
                })
              ).arrayBuffer(),
            ),
          ),
          imageHash,
        );
      }
      await stopCore(restarted.managed);
      assert.equal((await stat(target)).ino, originalInode);
      assert.equal(
        (await stat(path.join(target, 'Contents/MacOS/Locade'))).ino,
        originalExecutableInode,
      );
      record(activeStep, {
        unchangedBinaryIdentity: true,
        screenshotPreserved: Boolean(imageFile),
      });
      skip(
        'same-build-replacement',
        '仅 --exercise-replacement 显式执行；默认不更换已放行副本',
      );
      skip(
        'uninstall-and-reinstall',
        '仅 --exercise-replacement 显式执行；默认保留已放行副本',
      );
    } else {
      console.log(
        '显式替换验收：同路径文件身份也会变化，管控策略可能要求重新放行。',
      );
      activeStep = 'replace-app-retains-data';
      const before = JSON.parse(
        await readFile(path.join(data, 'library.json')),
      );
      await copyVerified(source, staged);
      await assertNotRunning(target);
      await rename(target, retired);
      originalRetired = true;
      await rename(staged, target);
      assert.deepEqual(
        JSON.parse(await readFile(path.join(data, 'library.json'))),
        before,
      );
      if (nativeAvailable) await smoke(target, 1);
      else
        skip(
          'replaced-native-startup',
          '原生路径复验未执行；仅验证内置核心重启与资料',
        );
      let saved = JSON.parse(await readFile(path.join(data, 'library.json')));
      assert.equal(saved.projects[0].id, id);
      assert.equal(saved.projects[0].name, 'Retained Sandbox Project');
      assert.equal(saved.projects[0].favorite, true);
      assert.equal(saved.projects[0].lastOpened, before.projects[0].lastOpened);
      assert.equal(saved.projects[0].screenshot, before.projects[0].screenshot);
      assert.equal(saved.screenshotsEnabled, true);
      assert.equal(saved.autoRefresh, false);
      if (imageFile) assert.equal(digest(await readFile(imageFile)), imageHash);
      const replaced = await startInstalledCore(target);
      library = await api(replaced.base, 'library');
      assert.equal(library.projects[0].id, id);
      assert.equal(library.projects[0].favorite, true);
      if (imageFile)
        assert.equal(
          digest(
            Buffer.from(
              await (
                await fetch(`${replaced.base}/screenshots/${id}.png`, {
                  signal: AbortSignal.timeout(3000),
                })
              ).arrayBuffer(),
            ),
          ),
          imageHash,
        );
      await stopCore(replaced.managed);
      record(activeStep, {
        sameBuildReplacement: true,
        screenshotPreserved: Boolean(imageFile),
        screenshotSHA256: imageHash || null,
      });

      activeStep = 'uninstall-preserves-data-and-reinstall-reads-it';
      const retained = await readFile(path.join(data, 'library.json'));
      await quiet();
      await removeVerified(target);
      assert.equal(await exists(target), false);
      assert.deepEqual(
        await readFile(path.join(data, 'library.json')),
        retained,
      );
      if (imageFile) assert.equal(digest(await readFile(imageFile)), imageHash);
      assert.equal(
        (await fetch(fixtureUrl, { signal: AbortSignal.timeout(3000) })).status,
        200,
        '卸载应用不能影响未由应用启动的网页服务',
      );
      await copyVerified(source, target);
      if (nativeAvailable) await smoke(target, 1);
      else
        skip(
          'reinstalled-native-startup',
          '原生路径复验未执行；仅验证内置核心重启与资料',
        );
      const reinstalled = await startInstalledCore(target);
      library = await api(reinstalled.base, 'library');
      assert.equal(library.projects[0].id, id);
      assert.equal(library.projects[0].name, 'Retained Sandbox Project');
      assert.equal(library.projects[0].favorite, true);
      await stopCore(reinstalled.managed);
      saved = JSON.parse(await readFile(path.join(data, 'library.json')));
      assert.equal(saved.projects[0].id, id);
      assert.equal(saved.projects[0].name, 'Retained Sandbox Project');
      if (imageFile) assert.equal(digest(await readFile(imageFile)), imageHash);
      record(activeStep, {
        externalFixtureSurvives: true,
        nativeReinstall: nativeAvailable,
        installedCoreReinstall: true,
      });
    }
  }
} catch (error) {
  if (error.cleanupUnsafe) {
    safeToRemove = false;
    requiresInspection = true;
  }
  failure(activeStep, error);
} finally {
  for (const managed of children) {
    try {
      await finish(managed, true);
    } catch (error) {
      safeToRemove = false;
      requiresInspection = true;
      results.push({
        test: 'cleanup-owned-process',
        passed: false,
        reason: error.message,
      });
      process.exitCode = 1;
    }
  }
  if (data) {
    try {
      await quiet();
    } catch (error) {
      results.push({
        test: 'cleanup-runtime',
        passed: false,
        reason: error.message,
      });
      process.exitCode = 1;
    }
  }
  if (fixture?.listening) {
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
  if (originalRetired && safeToRemove) {
    try {
      if (await exists(target)) await removeVerified(target);
      await regular(retired, 'directory');
      assert.equal(await fingerprint(retired), sourceFingerprint);
      await rename(retired, target);
      originalRetired = false;
      record('original-fixed-copy-restored');
    } catch (error) {
      safeToRemove = false;
      failure('restore-original-fixed-copy', error);
    }
  }
  if (targetPrepared && safeToRemove && !originalRetired) {
    try {
      assert.equal(await fingerprint(target), sourceFingerprint);
      assert.equal((await stat(target)).ino, originalInode);
      assert.equal(
        (await stat(path.join(target, 'Contents/MacOS/Locade'))).ino,
        originalExecutableInode,
      );
      record('fixed-copy-retained-with-unchanged-identity');
    } catch (error) {
      safeToRemove = false;
      failure('retain-fixed-copy', error);
    }
  }
  if (mountPoint) {
    try {
      mounted = await probeMount();
      if (mounted) {
        try {
          await exec('/usr/bin/hdiutil', ['detach', mountPoint], {
            timeout: 30000,
          });
        } catch (error) {
          if (await probeMount()) throw error;
        }
        mounted = await probeMount();
        assert.equal(mounted, false, '只读DMG仍挂载，不删除挂载目录');
        record('readonly-dmg-detached');
      }
    } catch (error) {
      safeToRemove = false;
      results.push({
        test: 'detach-dmg',
        passed: false,
        reason: error.message,
      });
      process.exitCode = 1;
    }
  }
  if (sandbox && safeToRemove) {
    try {
      await rm(sandbox, { recursive: true, force: true });
      record('isolated-files-cleaned');
    } catch (error) {
      safeToRemove = false;
      requiresInspection = true;
      failure('cleanup-isolated-files', error);
    }
  }
  if (releaseLock) {
    if (requiresInspection || !safeToRemove) {
      requiresInspection = true;
      try {
        await writeFile(
          inspectionFile,
          JSON.stringify({
            tool: 'locade-install-validation',
            reason:
              '测试资源清理状态不确定，人工检查后才可再次 prepare / refresh',
            sandbox,
            data,
            target,
            trackedTestPids: [...children].map(({ child }) => child.pid),
          }),
          { flag: 'wx', mode: 0o600 },
        );
      } catch (error) {
        if (error.code !== 'EEXIST')
          failure('persist-inspection-marker', error);
      }
    }
    try {
      await releaseLock();
      record('validation-lock-released');
    } catch (error) {
      requiresInspection = true;
      failure('release-validation-lock', error);
      try {
        await writeFile(
          inspectionFile,
          JSON.stringify({
            tool: 'locade-install-validation',
            reason: '测试锁释放失败，需人工检查后继续',
            target,
          }),
          { flag: 'wx', mode: 0o600 },
        );
      } catch (markerError) {
        if (markerError.code !== 'EEXIST')
          failure('persist-lock-inspection-marker', markerError);
      }
    }
  }
  let priorNativeAttempt = null;
  const evidenceFile = paths.report('macos-install-first-attempt');
  try {
    if (await exists(evidenceFile)) {
      const evidence = JSON.parse(await readFile(evidenceFile));
      priorNativeAttempt = {
        report: path.relative(root, evidenceFile),
        result: evidence.results.find((item) => item.passed === false) || null,
        caveat: '首轮未采集真实信号和就绪证据，不推断具体信号或策略原因。',
      };
    }
  } catch (error) {
    failure('read-prior-native-evidence', error);
  }
  const overall = results.some((item) => item.passed === false)
    ? 'failed'
    : prepareOnly
      ? 'prepared'
      : results.some((item) => item.status === 'skipped')
        ? 'incomplete'
        : 'passed';
  if (!['passed', 'prepared'].includes(overall)) process.exitCode = 1;
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(
    reportFile,
    `${JSON.stringify(
      {
        overall,
        mode: prepareOnly
          ? 'prepare-only'
          : exerciseReplacement
            ? 'exercise-replacement'
            : 'fixed-copy-runtime',
        executionPerformed,
        version: sourceVersion || null,
        platform: process.platform,
        arch: process.arch,
        sourceKind: sourceKind || null,
        results,
        limitations,
        priorNativeAttempt,
        fixedCopy: {
          path: target,
          retained: targetPrepared && !originalRetired,
          reused: preparedWasReused,
          fingerprint: sourceFingerprint || null,
          bundleInode: originalInode || null,
          executableInode: originalExecutableInode || null,
        },
        cleanup: {
          sandboxRemoved: Boolean(sandbox && safeToRemove),
          dmgStillMounted: mounted,
          retainedSandbox: safeToRemove ? null : sandbox,
          requiresInspection,
          inspectionMarker: requiresInspection ? inspectionFile : null,
        },
      },
      null,
      2,
    )}\n`,
  );
}
