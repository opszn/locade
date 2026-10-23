import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.js';
import { discover, probe } from '../server/network.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'test-results/performance-baseline.json');
const fixtureCount = 5;
const repeatedScans = 5;
const startupCount = 3;
const idleDurationMs = 30000;
const sampleIntervalMs = 1000;
const settleDurationMs = 3000;
const fixtures = [];
const children = [];
let app;
let dataDir;
let interrupted = false;
const onInterrupt = () => {
  interrupted = true;
};
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);

const round = (value) => Number(value.toFixed(3));
async function coreSourceFingerprint() {
  const files = [
    'package.json',
    'package-lock.json',
    ...(await readdir(path.join(root, 'server')))
      .filter((name) => name.endsWith('.js'))
      .map((name) => `server/${name}`),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(path.join(root, file)));
    hash.update('\0');
  }
  return { files, sha256: hash.digest('hex') };
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: values.length,
    min: round(sorted[0]),
    median: round(
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    ),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    max: round(sorted.at(-1)),
  };
}

function checkInterrupted() {
  if (interrupted) throw new Error('基线测量被中断');
}

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

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeIdleConnections();
  server.closeAllConnections();
  await bounded(closed, 5000, '受控 HTTP 服务未能在 5 秒内关闭');
}

async function makeFixture(index) {
  const colors = ['#f35b35', '#487858', '#226a83', '#d6a433', '#725a43'];
  const title = `Locade controlled page ${index + 1}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>*{box-sizing:border-box}body{margin:0;padding:64px;background:#f4f1e9;color:#252722;font:20px Georgia,serif}
    main{max-width:1120px;margin:auto}header{border-bottom:2px solid #252722;padding-bottom:24px;font-size:16px}
    h1{font-size:76px;line-height:1.05;max-width:800px}.art{height:360px;border-radius:24px;background:${colors[index]};display:grid;place-items:center}
    .disc{width:220px;height:220px;border:40px solid #f4f1e9;border-radius:50%}footer{margin-top:24px}</style></head>
    <body><main><header>LOCADE / CONTROLLED LOCAL FIXTURE ${index + 1}</header><h1>A place for things you build.</h1>
    <div class="art"><div class="disc"></div></div><footer>${title} / no JavaScript or external resources</footer></main></body></html>`;
  const fixture = {
    title,
    requests: 0,
    rejectedPathRequests: 0,
    route: `/${randomUUID()}/`,
    htmlBytes: Buffer.byteLength(html),
  };
  fixture.server = http.createServer((request, response) => {
    // Root scans must not seed this temporary page into a live user library.
    if (request.method !== 'GET' || request.url !== fixture.route) {
      fixture.rejectedPathRequests++;
      response.writeHead(404);
      return response.end();
    }
    fixture.requests++;
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(html);
  });
  fixtures.push(fixture);
  fixture.url = `${await listen(fixture.server)}${fixture.route}`;
  return fixture;
}

function requestCounts() {
  return fixtures.map((fixture) => fixture.requests);
}

function requestDelta(before) {
  return fixtures.map((fixture, index) => fixture.requests - before[index]);
}

async function jsonRequest(
  base,
  endpoint,
  { method = 'GET', token, data } = {},
) {
  checkInterrupted();
  const response = await fetch(`${base}/api/${endpoint}`, {
    method,
    headers: {
      ...(token ? { 'X-Locade-Token': token } : {}),
      'Content-Type': 'application/json',
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(45000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(`${endpoint}: HTTP ${response.status}: ${value.error}`);
  return value;
}

// The source CLI stays unchanged; IPC samples only this child, not the test driver.
const instrumentation = `
  import { performance } from 'node:perf_hooks';
  process.on('message', (message) => {
    if (message?.type !== 'locade-benchmark-snapshot') return;
    const rssBytes = process.memoryUsage.rss();
    const cpuMicroseconds = process.cpuUsage();
    process.send?.({type: message.type, id: message.id,
      monotonicMs: performance.now(), rssBytes, cpuMicroseconds}, () => {});
  });
`;

function launchCore(directory) {
  const env = { ...process.env, PORT: '0', LOCADE_DATA_DIR: directory };
  delete env.NODE_OPTIONS;
  delete env.LOCADE_PARENT_PID;
  const child = spawn(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(instrumentation)}`,
      'server/index.js',
    ],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  const record = { child, log: '', stderr: '', snapshotId: 0 };
  record.exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => {
      record.error = error;
      resolve({ error: error.message });
    });
  });
  child.stdout.on('data', (chunk) => {
    record.log = `${record.log}${chunk}`.slice(-8192);
  });
  child.stderr.on('data', (chunk) => {
    record.stderr = `${record.stderr}${chunk}`.slice(-8192);
  });
  children.push(record);
  return record;
}

function isAlive(record) {
  return (
    record.child.pid &&
    record.child.exitCode === null &&
    record.child.signalCode === null
  );
}

async function stopCore(record) {
  if (isAlive(record)) {
    record.child.kill('SIGTERM');
    try {
      await bounded(record.exited, 5000, '源码核心正常退出超时');
    } catch {
      if (isAlive(record)) record.child.kill('SIGKILL');
      await bounded(record.exited, 2000, '自有源码核心强制退出仍超时');
    }
  }
  return record.exited;
}

async function waitForCore(record, directory) {
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    checkInterrupted();
    if (record.error || !isAlive(record))
      throw new Error(
        `源码核心就绪前退出：${record.error?.message || record.stderr || record.child.signalCode || record.child.exitCode}`,
      );
    let runtime;
    try {
      runtime = JSON.parse(
        await readFile(path.join(directory, 'runtime.json'), 'utf8'),
      );
    } catch {
      /* The source CLI writes this after binding its loopback port. */
    }
    if (runtime?.pid === record.child.pid && runtime.port > 0) {
      const base = `http://127.0.0.1:${runtime.port}`;
      const health = await jsonRequest(base, 'health');
      assert.equal(health.application, 'locade');
      assert.equal(health.instance, runtime.instance);
      return { base, health };
    }
    await delay(10);
  }
  throw new Error('源码核心未能在 10 秒内提供环回 API');
}

async function snapshot(record) {
  checkInterrupted();
  assert.ok(isAlive(record), '空闲采样期间源码核心必须存活');
  const id = ++record.snapshotId;
  let listener;
  try {
    return await bounded(
      new Promise((resolve, reject) => {
        listener = (message) => {
          if (
            message?.type === 'locade-benchmark-snapshot' &&
            message.id === id
          )
            resolve(message);
        };
        record.child.on('message', listener);
        record.child.send(
          { type: 'locade-benchmark-snapshot', id },
          (error) => {
            if (error) reject(error);
          },
        );
      }),
      2000,
      '源码核心 IPC 采样超过 2 秒',
    );
  } finally {
    record.child.off('message', listener);
  }
}

const report = {
  formatVersion: 1,
  measuredAt: new Date().toISOString(),
  status: 'incomplete',
  environment: {
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    nodeVersion: process.version,
    logicalCpuCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    totalMemoryBytes: os.totalmem(),
  },
  conditions: {
    fixtureCount,
    fixtureContent: '受控静态 HTML + 内联 CSS；无 JS、外部字体、图片或远程请求',
    data: '临时隔离资料库；5 张卡片和 5 张截图；结束后删除',
    discovery:
      'discover() 仅探测本脚本的 5 个随机路径 knownUrls，根路径为 404；真实 HTTP probe，不枚举候选端口/lsof，不读取目录身份',
    screenshot:
      '真实 capture()，1440×960；每张新开并关闭浏览器，含现有 700ms 稳定等待、身份复核、PNG 落盘与 API 返回',
    startup:
      '现有 Node 可执行文件启动 server/index.js；从 spawn 前到 /api/health 返回并校验；10ms 就绪轮询',
    idle: '源码 Node 核心，5 卡/5 图的资料库；无菜单栏、Web 前端、截图浏览器或自动刷新；3s settle 后采样 30s',
  },
  limitations: [
    '仅当前机器、当前源码和既有运行时的受控合成基线，不是竞品、真实项目、干净系统或全部支持平台基准。',
    '没有清理系统磁盘缓存，没有控制机器其他负载或电源状态；样本数较小，不能据此宣称达到性能目标。',
    '受控已知地址探测不是完整系统发现；不包含候选端口根路径分支、lsof 枚举、PID/cwd/Git 身份读取、失败端口或复杂网页成本。',
    '首次将已知地址收录和重复刷新分别统计，每轮均为 5 次真实 HTTP 探测；截图单页各一次，浏览器/文件缓存可能已暖。',
    '空闲 RSS/CPU 只属于源码 Node 核心，不包括驱动进程、5 个测试网页、菜单栏、前端或截图 Chromium，不能称为整个应用资源占用。',
    'CPU 为 process.cpuUsage() 的用户态+系统态增量除以同进程单调时钟窗口，以一个逻辑核心为 100%；IPC/RSS 采样开销计入其中。',
  ],
};

try {
  console.log('开始本地受控基线：5 个临时网页；不扫描真实用户服务。');
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'locade-benchmark-'));
  const metadata = JSON.parse(
    await readFile(
      path.join(root, 'node_modules/playwright/package.json'),
      'utf8',
    ),
  );
  report.environment.playwrightVersion = metadata.version;
  const browsers = JSON.parse(
    await readFile(
      path.join(root, 'node_modules/playwright-core/browsers.json'),
      'utf8',
    ),
  );
  const expectedBrowser = browsers.browsers.find(
    (browser) => browser.name === 'chromium-headless-shell',
  );
  report.environment.playwrightExpectedChromium = {
    revision: expectedBrowser.revision,
    version: expectedBrowser.browserVersion,
    source: 'Playwright 安装元数据，不是独立版本实测；覆盖路径可能不同',
  };
  report.environment.browserSelection = process.env.LOCADE_BROWSER_EXECUTABLE
    ? '使用已有 LOCADE_BROWSER_EXECUTABLE，不复制或下载浏览器'
    : 'capture() 默认 Playwright headless，复用已有安装；不复制或下载浏览器';
  report.coreSource = await coreSourceFingerprint();
  for (let index = 0; index < fixtureCount; index++) await makeFixture(index);
  for (const fixture of fixtures) {
    const response = await fetch(new URL('/', fixture.url), {
      signal: AbortSignal.timeout(2000),
    });
    await response.arrayBuffer();
    assert.equal(response.status, 404, '普通根路径扫描不能收录测试网页');
  }
  report.fixtures = fixtures.map(({ title, htmlBytes }) => ({
    title,
    htmlBytes,
    rootStatusVerified: 404,
  }));

  let latestDiscovery;
  app = await createApp({
    dataDir,
    discoverProjects: async (excludedPort, knownUrls) => {
      const started = performance.now();
      const controlledUrls = fixtures.map((fixture) => fixture.url);
      assert.ok(knownUrls.every((url) => controlledUrls.includes(url)));
      const result = await discover(
        excludedPort,
        [...controlledUrls, ...knownUrls],
        {
          inventory: async () => ({
            ports: [],
            source: 'controlled-known-url-allowlist',
          }),
        },
      );
      latestDiscovery = {
        elapsedMs: round(performance.now() - started),
        storedKnownUrlCount: knownUrls.length,
        controlledUrlCount: controlledUrls.length,
        foundResultCount: result.found.length,
      };
      return result;
    },
    inspectProject: probe,
  });
  const base = await listen(app.server);
  let library = await jsonRequest(base, 'library');
  const token = library.token;
  const scanSamples = [];
  for (let index = 0; index <= repeatedScans; index++) {
    const before = requestCounts();
    const started = performance.now();
    library = await jsonRequest(base, 'scan', { method: 'POST', token });
    const elapsedMs = round(performance.now() - started);
    assert.equal(library.projects.length, fixtureCount);
    assert.ok(library.projects.every((project) => project.online));
    const requestsPerFixture = requestDelta(before);
    assert.deepEqual(requestsPerFixture, Array(fixtureCount).fill(1));
    scanSamples.push({
      kind:
        index === 0 ? 'initial-known-url-import' : 'repeated-known-url-refresh',
      elapsedMs,
      discovery: latestDiscovery,
      requestsPerFixture,
      totalHttpProbes: requestsPerFixture.reduce(
        (sum, value) => sum + value,
        0,
      ),
    });
  }
  report.scan = {
    samples: scanSamples,
    initialElapsedMs: scanSamples[0].elapsedMs,
    repeatedApiElapsedMs: summary(
      scanSamples.slice(1).map((item) => item.elapsedMs),
    ),
    repeatedDiscoveryElapsedMs: summary(
      scanSamples.slice(1).map((item) => item.discovery.elapsedMs),
    ),
  };
  console.log(
    `受控地址刷新：首次 ${report.scan.initialElapsedMs} ms；5 次重复中位 ${report.scan.repeatedApiElapsedMs.median} ms（每次 5 次真实 HTTP 探测，不含端口枚举）。`,
  );

  await jsonRequest(base, 'settings', {
    method: 'PATCH',
    token,
    data: { screenshotsEnabled: true, autoRefresh: false },
  });
  const captureSamples = [];
  for (const project of library.projects) {
    const before = requestCounts();
    const started = performance.now();
    library = await jsonRequest(base, `projects/${project.id}/screenshot`, {
      method: 'POST',
      token,
    });
    const elapsedMs = round(performance.now() - started);
    const png = await readFile(
      path.join(dataDir, 'screenshots', `${project.id}.png`),
    );
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 1440);
    assert.equal(png.readUInt32BE(20), 960);
    captureSamples.push({
      fixture: project.name,
      elapsedMs,
      pngBytes: png.length,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      requestsPerFixture: requestDelta(before),
    });
  }
  report.screenshots = {
    samples: captureSamples,
    apiElapsedMs: summary(captureSamples.map((item) => item.elapsedMs)),
    totalElapsedMs: round(
      captureSamples.reduce((sum, item) => sum + item.elapsedMs, 0),
    ),
  };
  console.log(
    `截图：5/5 PNG；中位 ${report.screenshots.apiElapsedMs.median} ms，范围 ${report.screenshots.apiElapsedMs.min}–${report.screenshots.apiElapsedMs.max} ms（含稳定等待）。`,
  );
  await closeServer(app.server);
  await bounded(app.store.pending, 5000, 'API 存储事务未能结束');
  await app.release();
  app = null;

  const startupSamples = [];
  let idleRecord;
  for (let index = 0; index < startupCount; index++) {
    checkInterrupted();
    const started = performance.now();
    const record = launchCore(dataDir);
    const ready = await waitForCore(record, dataDir);
    startupSamples.push({ elapsedMs: round(performance.now() - started) });
    const savedLibrary = await jsonRequest(ready.base, 'library');
    assert.equal(savedLibrary.projects.length, fixtureCount);
    assert.equal(
      savedLibrary.projects.filter((project) => project.screenshot).length,
      fixtureCount,
    );
    report.applicationVersion = ready.health.version;
    if (index === startupCount - 1) idleRecord = record;
    else {
      const ended = await stopCore(record);
      assert.equal(ended.code, 0);
      assert.equal(ended.signal, null);
    }
  }
  report.coreStartup = {
    samples: startupSamples,
    elapsedMs: summary(startupSamples.map((item) => item.elapsedMs)),
    fixtureProjectCount: fixtureCount,
    storedScreenshotCount: fixtureCount,
  };
  console.log(
    `源码核心启动：3 次中位 ${report.coreStartup.elapsedMs.median} ms；开始约 30 秒空闲采样，仅测 Node 核心。`,
  );
  await delay(settleDurationMs);
  const beforeIdleRequests = requestCounts();
  const snapshots = [await snapshot(idleRecord)];
  const idleStarted = performance.now();
  for (let index = 1; index <= idleDurationMs / sampleIntervalMs; index++) {
    await delay(
      Math.max(0, idleStarted + index * sampleIntervalMs - performance.now()),
    );
    snapshots.push(await snapshot(idleRecord));
  }
  assert.deepEqual(
    requestDelta(beforeIdleRequests),
    Array(fixtureCount).fill(0),
  );
  const first = snapshots[0];
  const last = snapshots.at(-1);
  const durationMs = last.monotonicMs - first.monotonicMs;
  const userCpuMs =
    (last.cpuMicroseconds.user - first.cpuMicroseconds.user) / 1000;
  const systemCpuMs =
    (last.cpuMicroseconds.system - first.cpuMicroseconds.system) / 1000;
  report.idleCore = {
    settleDurationMs,
    plannedDurationMs: idleDurationMs,
    observedDurationMs: round(durationMs),
    plannedSampleIntervalMs: sampleIntervalMs,
    sampleCount: snapshots.length,
    cpu: {
      userMs: round(userCpuMs),
      systemMs: round(systemCpuMs),
      totalMs: round(userCpuMs + systemCpuMs),
      meanPercentOfOneLogicalCpu: round(
        ((userCpuMs + systemCpuMs) / durationMs) * 100,
      ),
    },
    rssMiB: summary(snapshots.map((item) => item.rssBytes / 1024 ** 2)),
    samples: snapshots.map((item) => ({
      elapsedMs: round(item.monotonicMs - first.monotonicMs),
      rssBytes: item.rssBytes,
      cpuMicroseconds: item.cpuMicroseconds,
    })),
    fixtureRequestsDuringIdle: 0,
  };
  const ended = await stopCore(idleRecord);
  assert.equal(ended.code, 0);
  assert.equal(ended.signal, null);
  await assert.rejects(access(path.join(dataDir, 'instance.lock')), {
    code: 'ENOENT',
  });
  await assert.rejects(access(path.join(dataDir, 'runtime.json')), {
    code: 'ENOENT',
  });
  console.log(
    `空闲核心：${round(durationMs / 1000)} s，CPU ${report.idleCore.cpu.meanPercentOfOneLogicalCpu}% / 单核，RSS 中位 ${report.idleCore.rssMiB.median} MiB。不是整个 macOS 应用占用。`,
  );
  assert.equal(
    (await coreSourceFingerprint()).sha256,
    report.coreSource.sha256,
    '测量期间核心源码或依赖清单变化，本轮不能作为同一版本基线',
  );
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
  console.error(`本地基线未完成：${error.message}`);
} finally {
  const cleanupErrors = [];
  for (const record of children) {
    try {
      await stopCore(record);
    } catch (error) {
      cleanupErrors.push(error.message);
    }
  }
  if (app) {
    try {
      await closeServer(app.server);
      await bounded(
        app.store.pending,
        10000,
        '清理时 API 事务未能在 10 秒内结束',
      );
      await bounded(app.release(), 2000, '临时实例锁清理超时');
    } catch (error) {
      cleanupErrors.push(error.message);
    }
  }
  for (const fixture of fixtures) {
    try {
      await closeServer(fixture.server);
    } catch (error) {
      cleanupErrors.push(error.message);
    }
  }
  if (dataDir) {
    try {
      await bounded(
        rm(dataDir, { recursive: true, force: true }),
        10000,
        '临时资料清理超时',
      );
    } catch (error) {
      cleanupErrors.push(error.message);
    }
  }
  report.cleanup = {
    completed: cleanupErrors.length === 0,
    errors: cleanupErrors,
  };
  report.fixtureRequestCounts = fixtures.map((fixture) => ({
    title: fixture.title,
    expectedPathRequests: fixture.requests,
    rejectedPathRequests: fixture.rejectedPathRequests,
  }));
  if (cleanupErrors.length) {
    report.status = 'failed';
    process.exitCode = 1;
    console.error(`清理未完整结束：${cleanupErrors.join('；')}`);
  }
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onInterrupt);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(`报告：${output}；未设性能达标阈值，不能据此宣称竞品优势。`);
}
