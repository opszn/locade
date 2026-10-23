import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { releasePaths, assertReleaseDirectory } from './macos-release.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const paths = releasePaths(root);
await assertReleaseDirectory(paths);
const { app } = paths;
const runtime = path.join(app, 'Contents/Resources/Runtime');
const data = await mkdtemp(path.join(os.tmpdir(), 'locade-native-'));
const results = [];
let nativeAvailable = false;
try {
  const started = Date.now();
  try {
    const { stdout } = await exec(
      path.join(app, 'Contents/MacOS/Locade'),
      ['--smoke-test', '--no-discovery'],
      {
        env: {
          ...process.env,
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          LOCADE_DATA_DIR: data,
          NODE_OPTIONS: '--invalid-flag-must-not-inherit',
        },
        timeout: 45000,
      },
    );
    assert.match(stdout, /LOCADE_SMOKE_OK .*owns=true/);
    await assert.rejects(access(path.join(data, 'instance.lock')));
    await assert.rejects(access(path.join(data, 'runtime.json')));
    console.log(
      `✓ 菜单栏启动 → 内置 Node → 就绪 → 仅关闭自有后台，${Date.now() - started} ms`,
    );
    results.push({
      test: 'native-lifecycle',
      passed: true,
      elapsedMs: Date.now() - started,
    });
    nativeAvailable = true;
  } catch (error) {
    console.error(
      `✗ 原生生命周期未通过：${error.signal || error.message}\n  ${error.killed ? '达到测试超时，需检查启动 / 退出流程，而非直接判定为签名拒绝。' : '请结合系统日志和应用输出判断是否受到进程策略阻拦。'} 本脚本不修改系统安全设置。`,
    );
    results.push({
      test: 'native-lifecycle',
      passed: false,
      reason: error.signal || error.message,
      timedOut: error.killed === true,
      reachedReadiness: /LOCADE_SMOKE_OK/.test(error.stdout || ''),
    });
    process.exitCode = 1;
  }
  if (nativeAvailable) {
    const attachedData = await mkdtemp(
      path.join(os.tmpdir(), 'locade-attach-'),
    );
    let attachedService;
    try {
      attachedService = spawn(path.join(runtime, 'node'), ['server/index.js'], {
        cwd: runtime,
        env: {
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          HOME: attachedData,
          PORT: '0',
          LOCADE_DATA_DIR: attachedData,
        },
        stdio: 'ignore',
      });
      await once(attachedService, 'spawn');
      const serviceExit = once(attachedService, 'exit');
      let record;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          attachedService.exitCode !== null ||
          attachedService.signalCode !== null
        )
          throw new Error('隔离后台在就绪前退出');
        try {
          record = JSON.parse(
            await readFile(path.join(attachedData, 'runtime.json'), 'utf8'),
          );
          break;
        } catch {
          await delay(50);
        }
      }
      assert.ok(record?.port > 0, '隔离后台需要就绪');
      const { stdout } = await exec(
        path.join(app, 'Contents/MacOS/Locade'),
        ['--smoke-test', '--no-discovery'],
        {
          env: {
            ...process.env,
            PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
            LOCADE_DATA_DIR: attachedData,
          },
          timeout: 45000,
        },
      );
      assert.match(stdout, /LOCADE_SMOKE_OK .*owns=false/);
      const health = await (
        await fetch(`http://127.0.0.1:${record.port}/api/health`)
      ).json();
      assert.equal(health.instance, record.instance);
      assert.equal(attachedService.exitCode, null);
      attachedService.kill('SIGTERM');
      const [code, signal] = await serviceExit;
      assert.equal(code, 0);
      assert.equal(signal, null);
      console.log('✓ 连接已有后台 → 退出菜单栏 → 原后台仍可访问且实例未变化');
      results.push({ test: 'native-attach-preserves-service', passed: true });
    } catch (error) {
      console.error(
        `✗ 原生附着 / 所有权测试未通过：${error.signal || error.message}`,
      );
      results.push({
        test: 'native-attach-preserves-service',
        passed: false,
        reason: error.signal || error.message,
      });
      process.exitCode = 1;
    } finally {
      if (
        attachedService?.pid &&
        attachedService.exitCode === null &&
        attachedService.signalCode === null
      ) {
        const exited = once(attachedService, 'exit');
        attachedService.kill('SIGTERM');
        await exited;
      }
      await rm(attachedData, { recursive: true, force: true });
    }
  } else {
    results.push({
      test: 'native-attach-preserves-service',
      passed: null,
      status: 'skipped',
      reason: '首轮原生启动未通过，不再次执行相同二进制',
    });
  }
  try {
    const script = `
      import http from 'node:http';
      import { capture } from './server/capture.js';
      import { once } from 'node:events';
      const server = http.createServer((_q,r)=>{r.setHeader('Content-Type','text/html');r.end('<h1>Bundled runtime</h1>')});
      server.listen(0, '127.0.0.1'); await once(server,'listening');
      try { await capture('http://127.0.0.1:'+server.address().port, process.env.OUTPUT, 1); console.log('BUNDLED_CAPTURE_OK'); }
      finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
    `;
    const { stdout } = await exec(
      path.join(runtime, 'node'),
      ['--input-type=module', '-e', script],
      {
        cwd: runtime,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: data,
          OUTPUT: path.join(data, 'capture.png'),
          LOCADE_BROWSER_EXECUTABLE: path.join(
            runtime,
            'browser/chrome-headless-shell',
          ),
        },
        timeout: 25000,
      },
    );
    assert.match(stdout, /BUNDLED_CAPTURE_OK/);
    assert.equal(
      (await readFile(path.join(data, 'capture.png')))
        .subarray(1, 4)
        .toString(),
      'PNG',
    );
    console.log('✓ 内置截图浏览器，无外部 Node / Playwright 缓存依赖');
    results.push({ test: 'bundled-capture', passed: true });
  } catch (error) {
    console.error(`✗ 内置截图运行测试未通过：${error.signal || error.message}`);
    results.push({
      test: 'bundled-capture',
      passed: false,
      reason: error.signal || error.message,
    });
    process.exitCode = 1;
  }
  const fs = await import('node:fs/promises');
  await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
  await fs.writeFile(
    paths.report('macos-runtime'),
    JSON.stringify(results, null, 2),
  );
} finally {
  await rm(data, { recursive: true, force: true });
}
