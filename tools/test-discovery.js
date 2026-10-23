import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createApp } from '../server/index.js';
import { discover, listeningPorts, probe } from '../server/network.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputName =
  outputIndex === -1 ? 'system-discovery.json' : args[outputIndex + 1];
if (
  !outputName ||
  !/^system-discovery(?:-[a-z0-9-]+)?\.json$/.test(outputName) ||
  args.length !== (outputIndex === -1 ? 0 : 2) ||
  (outputIndex !== -1 && outputIndex !== 0)
)
  throw new Error(
    '用法：node tools/test-discovery.js [--output system-discovery-node24.json]',
  );
const output = path.join(root, 'test-results', outputName);
const fixtureRoute = `/${randomUUID()}/`;
const children = [];
const knownUrls = new Set();
const sourceFiles = [
  'server/index.js',
  'server/network.js',
  'server/identity.js',
  'server/store.js',
  'server/instance.js',
  'server/project-actions.js',
  'server/review.js',
];
let temporary;
let app;
let base;
let token;
let interrupted = false;
const onInterrupt = () => {
  interrupted = true;
};
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);

// Only this inline fixture is executed. No discovered project scripts are run.
const fixtureSource = `
import http from 'node:http';
const route = process.env.LOCADE_FIXTURE_ROUTE;
const title = process.env.LOCADE_FIXTURE_TITLE;
const send = (message) => process.connected && process.send(message);
const server = http.createServer((request, response) => {
  const accepted = request.method === 'GET' && request.url === route;
  send({ type: 'request', accepted, root: request.url === '/' });
  response.writeHead(accepted ? 200 : 404, {
    'Content-Type': accepted ? 'text/html; charset=utf-8' : 'text/plain',
    'Cache-Control': 'no-store',
    'Connection': 'close',
  });
  response.end(accepted ? '<!doctype html><title>' + title + '</title><h1>Owned test fixture</h1>' : 'Not found');
});
server.on('clientError', (_error, socket) => socket.destroy());
server.listen(Number(process.env.LOCADE_FIXTURE_PORT || 0), '127.0.0.1', () => {
  send({ type: 'ready', port: server.address().port });
});
process.on('message', async (message) => {
  if (message?.type !== 'command') return;
  try {
    if (message.action === 'close-listener') {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    } else if (message.action === 'listen') {
      await new Promise((resolve, reject) => {
        const failed = (error) => reject(error);
        server.once('error', failed);
        server.listen(message.port, '127.0.0.1', () => {
          server.off('error', failed);
          resolve();
        });
      });
    } else {
      throw new Error('Unsupported fixture command');
    }
    send({ type: 'reply', id: message.id, port: server.address()?.port ?? null });
  } catch (error) {
    send({ type: 'reply', id: message.id, error: error.message });
  }
});
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  const forced = setTimeout(() => process.exit(2), 3000);
  forced.unref();
  server.close(() => process.exit(0));
  server.closeAllConnections();
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
process.on('disconnect', close);
`;

const report = {
  startedAt: new Date().toISOString(),
  status: 'running',
  runtime: {
    node: process.version,
    executable: process.execPath,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
  },
  scope: {
    realSystemCalls: [
      'production listeningPorts(): lsof TCP listener inventory',
      'production discover(): candidate root and known URL HTTP(S) probes',
      'production discover() enrich: processIdentity() lsof cwd + ps lstart',
      'production detectDirectory()/directoryIdentity(): on-disk markers and Git HEAD',
      'production createApp()/Store: HTTP API, instance lock and persisted library',
    ],
    injectedInputs: [
      'Inventory allowlist only: raw lsof listeners are filtered by owned child PID before discover receives them',
      'Known URLs: unpredictable fixture paths supplied explicitly, not a complete cold-root discovery test',
      'Fixture content, directories, package markers, and minimal empty Git repositories are generated test data',
      'A synthetic 1px PNG and timestamp are seeded into the isolated Store only to verify cover ownership; it is not a browser screenshot',
    ],
    exclusions: [
      'No browser, Chromium, screenshot capture, IDE or native app interaction',
      'No request to unrelated listener ports; unrelated lsof metadata is counted but not retained',
      'No user library, project scripts, security policy, login item or application bundle changes',
      'API restart is in-process close/re-create, not native shell or OS process restart',
      'This checks correctness, not user recovery speed, retention or competing products',
    ],
    rootPolicy: 'Every fixture returns HTTP 404 at / for its entire lifetime',
  },
  plannedChecks: 7,
  checks: [],
  inventories: [],
  scans: [],
  fixtures: [],
  apiInstances: [],
};

async function bounded(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function checkInterrupted() {
  if (interrupted) throw new Error('真实系统发现验证被中断');
}

async function fingerprint() {
  const files = [];
  const hash = createHash('sha256');
  for (const file of sourceFiles) {
    const content = await readFile(path.join(root, file));
    const sha256 = createHash('sha256').update(content).digest('hex');
    files.push({ file, sha256 });
    hash.update(`${file}\0${sha256}\0`);
  }
  return { files, sha256: hash.digest('hex') };
}

async function makeRepository(directory, branch, applications) {
  await mkdir(path.join(directory, '.git', 'objects'), { recursive: true });
  await mkdir(path.join(directory, '.git', 'refs', 'heads'), {
    recursive: true,
  });
  await writeFile(
    path.join(directory, '.git', 'HEAD'),
    `ref: refs/heads/${branch}\n`,
  );
  await writeFile(
    path.join(directory, '.git', 'config'),
    '[core]\n\trepositoryformatversion = 0\n\tbare = false\n',
  );
  const directories = [];
  for (const application of applications) {
    const applicationDirectory = path.join(directory, 'apps', application);
    await mkdir(applicationDirectory, { recursive: true });
    await writeFile(
      path.join(applicationDirectory, 'package.json'),
      `${JSON.stringify({ name: application, private: true })}\n`,
    );
    directories.push(await realpath(applicationDirectory));
  }
  return {
    worktree: await realpath(directory),
    branch,
    head: (await readFile(path.join(directory, '.git', 'HEAD'), 'utf8')).trim(),
    directories,
  };
}

function live(record) {
  return (
    record.child.exitCode === null &&
    record.child.signalCode === null &&
    !record.exited
  );
}

async function launchFixture(name, directory, title, port = 0) {
  checkInterrupted();
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', fixtureSource],
    {
      cwd: directory,
      env: {
        ...process.env,
        LOCADE_FIXTURE_ROUTE: fixtureRoute,
        LOCADE_FIXTURE_TITLE: title,
        LOCADE_FIXTURE_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  const record = {
    child,
    name,
    directory,
    title,
    requestedPort: port,
    pid: child.pid,
    listening: false,
    stdout: '',
    stderr: '',
    requests: { accepted: 0, rejected: 0, roots: 0 },
    exited: false,
  };
  children.push(record);
  child.stdout.on('data', (chunk) => {
    record.stdout = `${record.stdout}${chunk}`.slice(-4096);
  });
  child.stderr.on('data', (chunk) => {
    record.stderr = `${record.stderr}${chunk}`.slice(-4096);
  });
  record.exit = new Promise((resolve) => {
    child.once('error', (error) => {
      record.spawnError = error.message;
      resolve({ error: error.message });
    });
    child.once('exit', (code, signal) => {
      record.exited = true;
      record.exitResult = { code, signal };
      resolve(record.exitResult);
    });
  });
  await bounded(
    new Promise((resolve, reject) => {
      const onMessage = (message) => {
        if (message?.type === 'request') {
          record.requests[message.accepted ? 'accepted' : 'rejected']++;
          if (message.root) record.requests.roots++;
        }
        if (message?.type === 'ready') {
          record.listening = true;
          record.port = message.port;
          record.url = `http://127.0.0.1:${message.port}${fixtureRoute}`;
          knownUrls.add(record.url);
          resolve();
        }
      };
      child.on('message', onMessage);
      record.exit.then((result) => {
        if (!record.port)
          reject(
            new Error(
              `fixture ${name} 启动前退出：${JSON.stringify(result)} ${record.stderr}`,
            ),
          );
      });
    }),
    8000,
    `fixture ${name} 启动超时`,
  );
  assert.ok(record.pid > 0);
  assert.ok(record.port > 0);
  if (port) assert.equal(record.port, port);
  const { stdout } = await exec(
    'ps',
    ['-p', String(record.pid), '-o', 'lstart='],
    {
      timeout: 1500,
      maxBuffer: 4096,
    },
  );
  record.expectedObservation = `${record.pid}:${stdout.trim()}`;
  assert.ok(stdout.trim(), '真实子进程应具有 ps 启动时间');
  return record;
}

async function stopFixture(record) {
  if (!live(record)) return record.exitResult;
  record.child.kill('SIGTERM');
  try {
    return await bounded(
      record.exit,
      5000,
      `fixture ${record.name} 未按时退出`,
    );
  } catch (error) {
    // The handle was returned by this tool's spawn; never signal a discovered PID.
    if (live(record)) record.child.kill('SIGKILL');
    await bounded(record.exit, 3000, `fixture ${record.name} 强制清理超时`);
    throw error;
  }
}

async function fixtureCommand(record, action, port) {
  assert.ok(live(record), 'IPC 命令只能发给本工具仍然存活的 fixture');
  const id = randomUUID();
  const result = await bounded(
    new Promise((resolve, reject) => {
      const onMessage = (message) => {
        if (message?.type !== 'reply' || message.id !== id) return;
        record.child.off('message', onMessage);
        if (message.error) reject(new Error(message.error));
        else resolve(message);
      };
      record.child.on('message', onMessage);
      record.child.send({ type: 'command', id, action, port }, (error) => {
        if (error) {
          record.child.off('message', onMessage);
          reject(error);
        }
      });
    }),
    5000,
    `fixture ${record.name} IPC ${action} 超时`,
  );
  record.listening = result.port !== null;
  if (record.listening) {
    record.port = result.port;
    record.url = `http://127.0.0.1:${record.port}${fixtureRoute}`;
    knownUrls.add(record.url);
  }
  return result;
}

async function ownedInventory() {
  checkInterrupted();
  const raw = await listeningPorts();
  assert.equal(
    raw.source,
    'lsof',
    'macOS 必须实际使用 lsof，不能把回退端口视为通过',
  );
  assert.ok(Array.isArray(raw.listeners), 'lsof 必须返回真实 listener 记录');
  const active = children.filter((record) => live(record) && record.listening);
  const pids = new Set(active.map((record) => record.pid));
  const listeners = raw.listeners.filter((listener) => pids.has(listener.pid));
  for (const record of active)
    assert.ok(
      listeners.some(
        (listener) =>
          listener.pid === record.pid && listener.port === record.port,
      ),
      `lsof 未找到自有 fixture ${record.name} 的真实 PID/端口`,
    );
  // Refuse to probe even an old fixture URL if another process now owns its port.
  const historicalPorts = new Set(
    [...knownUrls].map((url) => Number(new URL(url).port)),
  );
  const unrelatedClaim = raw.listeners.find(
    (listener) => historicalPorts.has(listener.port) && !pids.has(listener.pid),
  );
  assert.ok(
    !unrelatedClaim,
    '历史 fixture 端口已被外部进程占用，安全停止而不探测',
  );
  const ports = [...new Set(listeners.map((listener) => listener.port))];
  report.inventories.push({
    at: new Date().toISOString(),
    source: raw.source,
    totalSystemListenerCount: raw.listeners.length,
    excludedListenerCount: raw.listeners.length - listeners.length,
    allowedListeners: listeners,
    allowedPorts: ports,
    ownedChildPids: [...pids],
  });
  return { ports, listeners, source: raw.source };
}

async function discoverOwned(excludedPort, savedUrls) {
  for (const url of savedUrls)
    assert.ok(knownUrls.has(url), '临时资料库中不应出现非 fixture 地址');
  const urls = [...new Set([...savedUrls, ...knownUrls])];
  const result = await discover(excludedPort, urls, {
    inventory: ownedInventory,
  });
  for (const found of result.found)
    assert.ok(
      knownUrls.has(found.url),
      '根404的fixture不应出现未经允许的发现地址',
    );
  report.scans.push({
    at: new Date().toISOString(),
    source: result.source,
    elapsedMs: result.elapsedMs,
    limited: result.limited,
    knownUrls: urls,
    found: result.found,
    checked: result.checked,
  });
  assert.equal(result.limited, false);
  return result;
}

async function jsonRequest(endpoint, method = 'GET', input) {
  checkInterrupted();
  const response = await fetch(`${base}/api/${endpoint}`, {
    method,
    headers: {
      ...(method !== 'GET' && { 'X-Locade-Token': token }),
      ...(input !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(input !== undefined && { body: JSON.stringify(input) }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  assert.equal(
    response.status,
    200,
    `${method} ${endpoint}: ${JSON.stringify(result)}`,
  );
  if (Array.isArray(result.projects)) {
    report.lastLibrary = structuredClone(result);
    delete report.lastLibrary.token;
  }
  return result;
}

async function startApi(dataDir) {
  app = await createApp({ dataDir, discoverProjects: discoverOwned });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${app.server.address().port}`;
  const library = await jsonRequest('library');
  token = library.token;
  report.apiInstances.push({ base, instance: library.instance });
  return library;
}

async function closeApi() {
  if (!app) return;
  const closing = app;
  if (closing.server.listening) {
    const ended = new Promise((resolve, reject) => {
      closing.server.close((error) => (error ? reject(error) : resolve()));
    });
    closing.server.closeIdleConnections();
    closing.server.closeAllConnections();
    await bounded(ended, 5000, '测试 API 关闭超时');
  }
  await bounded(closing.store.pending, 5000, '测试 API 存储事务结束超时');
  await bounded(closing.release(), 2000, '测试 API 实例锁清理超时');
  app = null;
}

function projectFor(library, record) {
  const matches = library.projects.filter(
    (project) => project.identity?.directory === record.directory,
  );
  assert.equal(matches.length, 1, `${record.name} 应只关联一个项目卡片`);
  return matches[0];
}

function projectByObservation(library, record) {
  const matches = library.projects.filter((project) =>
    project.endpoints.some(
      (endpoint) =>
        endpoint.url === record.url &&
        endpoint.observation === record.expectedObservation,
    ),
  );
  assert.equal(matches.length, 1, `${record.name} 的进程证据应唯一关联卡片`);
  return matches[0];
}

function assertIdentity(project, record, repository) {
  assert.equal(project.identity.directory, record.directory);
  assert.equal(project.identity.source, 'auto');
  assert.equal(project.identity.available, true);
  assert.equal(project.identity.worktree, repository.worktree);
  assert.equal(project.identity.branch, repository.branch);
  const endpoint = project.endpoints.find((item) => item.url === record.url);
  assert.ok(endpoint, `${record.name} 的真实地址应关联到其项目`);
  assert.equal(endpoint.observation, record.expectedObservation);
}

function check(name, evidence) {
  report.checks.push({ name, passed: true, evidence });
  console.log(`通过：${name}`);
}

function durableFields(project) {
  return {
    id: project.id,
    name: project.name,
    favorite: project.favorite,
    identity: project.identity,
    addedAt: project.addedAt,
    lastOpened: project.lastOpened,
    url: project.url,
    addressReused: project.addressReused,
    endpoints: project.endpoints.map((endpoint) => ({
      url: endpoint.url,
      observation: endpoint.observation,
      addressReused: endpoint.addressReused,
    })),
  };
}

async function assertFixtureSurvives(record) {
  assert.ok(live(record), `${record.name} 不应被 API 关闭误停`);
  const found = await probe(record.url);
  assert.equal(found?.title, record.title);
}

try {
  assert.equal(
    process.platform,
    'darwin',
    '该工具明确验收 macOS，不在其他系统默默跳过',
  );
  report.sources = await fingerprint();
  temporary = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'locade-system-discovery-')),
  );
  const dataDir = path.join(temporary, 'library');
  const repository = await makeRepository(
    path.join(temporary, 'monorepo'),
    'fixture/shared-branch',
    ['alpha', 'beta'],
  );
  const otherRepository = await makeRepository(
    path.join(temporary, 'other-repo'),
    'fixture/replacement-branch',
    ['gamma'],
  );
  report.fixtureRepositories = [repository, otherRepository];
  const alpha = await launchFixture(
    'alpha-original',
    repository.directories[0],
    'Owned Alpha',
  );
  const beta = await launchFixture(
    'beta-sibling',
    repository.directories[1],
    'Owned Beta',
  );
  assert.notEqual(alpha.pid, beta.pid);
  assert.notEqual(alpha.port, beta.port);
  let library = await startApi(dataDir);
  assert.equal(library.projects.length, 0);
  library = await jsonRequest('scan', 'POST');
  assert.equal(library.projects.length, 2);
  let alphaProject = projectFor(library, alpha);
  const betaProject = projectFor(library, beta);
  assertIdentity(alphaProject, alpha, repository);
  assertIdentity(betaProject, beta, repository);
  assert.notEqual(alphaProject.id, betaProject.id);
  assert.notEqual(alphaProject.identity.key, betaProject.identity.key);
  assert.equal(alphaProject.identity.worktree, betaProject.identity.worktree);
  assert.ok(library.projects.every((project) => project.online));
  const alphaId = alphaProject.id;
  const betaId = betaProject.id;
  check('真实 lsof PID / cwd / Git HEAD；同一 monorepo 两个应用保持独立', {
    alpha: {
      pid: alpha.pid,
      observation: alpha.expectedObservation,
      project: alphaProject,
    },
    beta: {
      pid: beta.pid,
      observation: beta.expectedObservation,
      project: betaProject,
    },
    head: repository.head,
  });

  const renamed = 'Retained Alpha Name';
  library = await jsonRequest(`projects/${alphaId}`, 'PATCH', {
    name: renamed,
    favorite: true,
  });
  library = await jsonRequest(`projects/${alphaId}/opened`, 'POST');
  alphaProject = projectFor(library, alpha);
  const lastOpened = alphaProject.lastOpened;
  assert.ok(lastOpened);
  const firstExit = await stopFixture(alpha);
  assert.deepEqual(firstExit, { code: 0, signal: null });
  library = await jsonRequest('scan', 'POST');
  alphaProject = projectFor(library, alpha);
  assert.equal(alphaProject.id, alphaId);
  assert.equal(alphaProject.online, false);
  assert.equal(alphaProject.status, 'offline');
  assert.equal(alphaProject.name, renamed);
  assert.equal(alphaProject.favorite, true);
  assert.equal(alphaProject.lastOpened, lastOpened);
  assert.equal(alphaProject.identity.directory, alpha.directory);
  assert.equal(projectFor(library, beta).online, true);
  check('服务真实退出后离线保留 UUID / 名称 / 收藏 / 目录 / 最近访问', {
    project: alphaProject,
    stoppedChild: { pid: alpha.pid, exit: firstExit },
  });

  const movedAlpha = await launchFixture(
    'alpha-new-port',
    alpha.directory,
    alpha.title,
  );
  assert.notEqual(
    movedAlpha.port,
    alpha.port,
    '换端口场景必须实际使用不同端口',
  );
  assert.notEqual(movedAlpha.pid, alpha.pid);
  library = await jsonRequest('scan', 'POST');
  alphaProject = projectFor(library, movedAlpha);
  assertIdentity(alphaProject, movedAlpha, repository);
  assert.equal(alphaProject.id, alphaId);
  assert.equal(alphaProject.name, renamed);
  assert.equal(alphaProject.favorite, true);
  assert.equal(alphaProject.lastOpened, lastOpened);
  assert.equal(alphaProject.online, true);
  assert.equal(alphaProject.url, movedAlpha.url);
  assert.equal(alphaProject.addressReused, false);
  assert.equal(alphaProject.endpoints.length, 2);
  assert.equal(library.projects.length, 2);
  assert.equal(projectFor(library, beta).id, betaId);
  check('同目录真实新进程换端口后保留稳定项目与个性资料', {
    oldPid: alpha.pid,
    newPid: movedAlpha.pid,
    oldPort: alpha.port,
    newPort: movedAlpha.port,
    project: alphaProject,
  });

  const movedExit = await stopFixture(movedAlpha);
  assert.deepEqual(movedExit, { code: 0, signal: null });
  const gamma = await launchFixture(
    'gamma-reused-port',
    otherRepository.directories[0],
    alpha.title,
    movedAlpha.port,
  );
  library = await jsonRequest('scan', 'POST');
  alphaProject = projectFor(library, movedAlpha);
  let gammaProject = projectFor(library, gamma);
  assert.equal(library.projects.length, 3);
  assertIdentity(gammaProject, gamma, otherRepository);
  assert.equal(alphaProject.id, alphaId);
  assert.equal(alphaProject.online, false);
  assert.equal(alphaProject.addressReused, true);
  assert.equal(alphaProject.name, renamed);
  assert.equal(alphaProject.favorite, true);
  assert.equal(alphaProject.identity.directory, alpha.directory);
  assert.ok(
    alphaProject.endpoints.find((item) => item.url === movedAlpha.url)
      ?.addressReused,
  );
  assert.notEqual(gammaProject.id, alphaId);
  assert.notEqual(gammaProject.identity.key, alphaProject.identity.key);
  assert.equal(gammaProject.online, true);
  assert.equal(gammaProject.favorite, false);
  assert.equal(gammaProject.name, alpha.title);
  assert.equal(gammaProject.screenshot, null);
  assert.equal(gammaProject.lastOpened, null);
  assert.equal(projectFor(library, beta).id, betaId);
  assert.equal(projectFor(library, beta).online, true);
  check(
    '不同项目实际复用旧端口：旧卡片标记阻止，UUID / 目录 / 收藏 / 名称不继承',
    {
      reusedPort: gamma.port,
      oldProject: alphaProject,
      replacementProject: gammaProject,
      navigationScope:
        'Verified backend addressReused flag; browser/native interaction is not part of this tool',
    },
  );

  const beforeRestart = library.projects
    .map(durableFields)
    .sort((a, b) => a.id.localeCompare(b.id));
  const firstInstance = library.instance;
  await closeApi();
  await assert.rejects(access(path.join(dataDir, 'instance.lock')), {
    code: 'ENOENT',
  });
  await assertFixtureSurvives(beta);
  await assertFixtureSurvives(gamma);
  const saved = JSON.parse(
    await readFile(path.join(dataDir, 'library.json'), 'utf8'),
  );
  assert.equal(saved.projects.length, 3);
  library = await startApi(dataDir);
  assert.notEqual(library.instance, firstInstance);
  assert.ok(library.projects.every((project) => !project.online));
  assert.deepEqual(
    library.projects
      .map(durableFields)
      .sort((a, b) => a.id.localeCompare(b.id)),
    beforeRestart,
  );
  assert.equal(projectFor(library, movedAlpha).addressReused, true);
  check('API 关闭 / 重建恢复元数据与复用阻止标记；现存测试服务未被误停', {
    oldInstance: firstInstance,
    newInstance: library.instance,
    projectIds: library.projects.map((project) => project.id),
    survivingPids: [beta.pid, gamma.pid],
    allCardsStartOffline: true,
  });

  library = await jsonRequest('scan', 'POST');
  alphaProject = projectFor(library, movedAlpha);
  gammaProject = projectFor(library, gamma);
  assert.equal(library.projects.length, 3);
  assert.equal(alphaProject.id, alphaId);
  assert.equal(alphaProject.online, false);
  assert.equal(alphaProject.addressReused, true);
  assert.equal(projectFor(library, beta).id, betaId);
  assert.equal(projectFor(library, beta).online, true);
  assert.equal(gammaProject.online, true);
  assertIdentity(projectFor(library, beta), beta, repository);
  assertIdentity(gammaProject, gamma, otherRepository);
  assert.deepEqual(
    library.projects
      .map(durableFields)
      .sort((a, b) => a.id.localeCompare(b.id)),
    beforeRestart,
  );
  await closeApi();
  await assertFixtureSurvives(beta);
  await assertFixtureSurvives(gamma);
  await assert.rejects(access(path.join(dataDir, 'instance.lock')), {
    code: 'ENOENT',
  });
  check('重建后真实重新发现恢复在线且不新增重复卡片，旧复用卡继续安全阻止', {
    projects: library.projects,
    survivingPids: [beta.pid, gamma.pid],
  });

  const rolesRepository = await makeRepository(
    path.join(temporary, 'roles-repo'),
    'fixture/same-cwd-roles',
    ['shared-app'],
  );
  report.fixtureRepositories.push(rolesRepository);
  const frontend = await launchFixture(
    'same-cwd-frontend',
    rolesRepository.directories[0],
    'Owned Frontend',
  );
  const storybook = await launchFixture(
    'same-cwd-storybook',
    rolesRepository.directories[0],
    'Owned Storybook',
  );
  const frontendUrl = frontend.url;
  const storybookOriginalUrl = storybook.url;
  library = await startApi(dataDir);
  library = await jsonRequest('scan', 'POST');
  assert.equal(library.projects.length, 5);
  let frontendProject = projectByObservation(library, frontend);
  let storybookProject = projectByObservation(library, storybook);
  const frontendId = frontendProject.id;
  const storybookId = storybookProject.id;
  assert.notEqual(frontendId, storybookId);
  assert.equal(frontendProject.identity.key, storybookProject.identity.key);
  assertIdentity(frontendProject, frontend, rolesRepository);
  assertIdentity(storybookProject, storybook, rolesRepository);
  library = await jsonRequest(`projects/${frontendId}`, 'PATCH', {
    name: 'Saved Frontend Role',
    favorite: false,
  });
  library = await jsonRequest(`projects/${storybookId}`, 'PATCH', {
    name: 'Saved Storybook Role',
    favorite: true,
  });
  await jsonRequest('settings', 'PATCH', { screenshotsEnabled: true });
  const syntheticPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  );
  assert.equal(syntheticPng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(syntheticPng.readUInt32BE(16), 1);
  assert.equal(syntheticPng.readUInt32BE(20), 1);
  const syntheticTimestamp = new Date().toISOString();
  const frontendCover = path.join(dataDir, 'screenshots', `${frontendId}.png`);
  await app.store.transaction(async () => {
    await writeFile(frontendCover, syntheticPng, { mode: 0o600 });
    app.store.state.projects.find(
      (project) => project.id === frontendId,
    ).screenshot = syntheticTimestamp;
  });
  const syntheticHash = createHash('sha256').update(syntheticPng).digest('hex');
  const frontendExit = await stopFixture(frontend);
  assert.deepEqual(frontendExit, { code: 0, signal: null });
  await fixtureCommand(storybook, 'close-listener');
  assert.ok(live(storybook), 'Storybook 关闭 listener 后同一进程仍应存活');
  assert.equal(storybook.listening, false);
  const noStorybookListener = await listeningPorts();
  assert.equal(noStorybookListener.source, 'lsof');
  assert.ok(
    !noStorybookListener.listeners.some(
      (listener) => listener.pid === storybook.pid,
    ),
    'Storybook 进程暂停 listener 后不应仍被 lsof 列为监听者',
  );
  await fixtureCommand(storybook, 'listen', frontend.port);
  assert.equal(storybook.port, frontend.port);
  assert.equal(storybook.url, frontendUrl);
  const { stdout: movedStarted } = await exec(
    'ps',
    ['-p', String(storybook.pid), '-o', 'lstart='],
    { timeout: 1500, maxBuffer: 4096 },
  );
  assert.equal(
    `${storybook.pid}:${movedStarted.trim()}`,
    storybook.expectedObservation,
  );
  library = await jsonRequest('scan', 'POST');
  assert.equal(library.projects.length, 5);
  frontendProject = library.projects.find(
    (project) => project.id === frontendId,
  );
  storybookProject = library.projects.find(
    (project) => project.id === storybookId,
  );
  assert.ok(frontendProject && storybookProject);
  assert.equal(storybookProject.url, frontendUrl);
  assert.equal(storybookProject.name, 'Saved Storybook Role');
  assert.equal(storybookProject.favorite, true);
  assert.equal(storybookProject.screenshot, null);
  assert.equal(storybookProject.online, true);
  assert.equal(storybookProject.addressReused, false);
  assertIdentity(storybookProject, storybook, rolesRepository);
  assert.ok(
    storybookProject.endpoints.some(
      (endpoint) => endpoint.url === storybookOriginalUrl,
    ),
  );
  assert.equal(frontendProject.name, 'Saved Frontend Role');
  assert.equal(frontendProject.favorite, false);
  assert.equal(frontendProject.online, false);
  assert.equal(frontendProject.addressReused, true);
  assert.equal(frontendProject.screenshot, syntheticTimestamp);
  assert.equal(
    createHash('sha256')
      .update(await readFile(frontendCover))
      .digest('hex'),
    syntheticHash,
  );
  await assert.rejects(
    access(path.join(dataDir, 'screenshots', `${storybookId}.png`)),
    { code: 'ENOENT' },
  );
  check(
    '同 cwd 双角色以相同 PID / 启动时间迁移 listener：Storybook 保留自身卡片，Frontend 阻止且不转移封面 / 收藏',
    {
      commonDirectory: frontend.directory,
      frontendPid: frontend.pid,
      storybookPid: storybook.pid,
      unchangedStorybookObservation: storybook.expectedObservation,
      originalStorybookUrl: storybookOriginalUrl,
      reusedFrontendUrl: frontendUrl,
      frontendProject,
      storybookProject,
      coverFixture: {
        synthetic: true,
        width: 1,
        height: 1,
        sha256: syntheticHash,
        originalOwner: frontendId,
        notBrowserCapture: true,
      },
    },
  );
  await closeApi();
  await assertFixtureSurvives(storybook);
  await assertFixtureSurvives(beta);
  await assertFixtureSurvives(gamma);
  report.sourcesAfter = await fingerprint();
  assert.equal(
    report.sourcesAfter.sha256,
    report.sources.sha256,
    '测试期间关键源码变化，结果不能作为同一版本验收',
  );
  assert.equal(report.checks.length, report.plannedChecks);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  process.exitCode = 1;
  console.error(`真实系统发现验收失败：${error.message}`);
} finally {
  const errors = [];
  try {
    await closeApi();
  } catch (error) {
    errors.push(`API: ${error.message}`);
  }
  for (const record of children) {
    try {
      const result = await stopFixture(record);
      assert.deepEqual(result, { code: 0, signal: null });
      assert.equal(live(record), false);
    } catch (error) {
      errors.push(`${record.name}: ${error.message}`);
    }
    report.fixtures.push({
      name: record.name,
      pid: record.pid,
      directory: record.directory,
      url: record.url,
      requestedPort: record.requestedPort,
      actualPort: record.port,
      expectedObservationFromPs: record.expectedObservation,
      requests: record.requests,
      exit: record.exitResult,
      spawnError: record.spawnError,
      stdout: record.stdout,
      stderr: record.stderr,
    });
  }
  if (temporary) {
    try {
      await bounded(
        rm(temporary, { recursive: true, force: true }),
        10000,
        '临时目录清理超时',
      );
      await assert.rejects(access(temporary), { code: 'ENOENT' });
    } catch (error) {
      errors.push(`temporary directory: ${error.message}`);
    }
  }
  report.cleanup = {
    completed: errors.length === 0,
    allOwnedChildrenExited: children.every((record) => !live(record)),
    temporaryDirectoryRemoved:
      !!temporary &&
      errors.every((error) => !error.startsWith('temporary directory:')),
    errors,
  };
  if (errors.length) {
    report.status = 'failed';
    process.exitCode = 1;
    console.error(`清理未完整结束：${errors.join('；')}`);
  }
  report.completedAt = new Date().toISOString();
  report.passedChecks = report.checks.filter((item) => item.passed).length;
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onInterrupt);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    `报告：${output}；状态 ${report.status}，${report.passedChecks} 项检查。`,
  );
}
