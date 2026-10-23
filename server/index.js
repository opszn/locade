import http from 'node:http';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Store, urlKey } from './store.js';
import { discover, localUrl, inspectUrl } from './network.js';
import { capture } from './capture.js';
import { directoryIdentity, refreshIdentity } from './identity.js';
import { acquireInstance } from './instance.js';
import {
  exportBackup,
  parseBackup,
  restoreBackup,
  MAX_BACKUP_BYTES,
} from './backup.js';
import { openDirectory } from './integrations.js';
import { projectReviewKey, updateVisibility } from './review.js';
import {
  assertProjectAddress,
  validateProjectPatch,
  verifyProjectPage,
} from './project-actions.js';
import { sendNavigationError } from './navigation-error.js';
import { APP_VERSION } from './version.js';
import { normalizeLanguage, translateMessage } from './i18n.js';
import { screenshotCapability } from './capabilities.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function rawBody(request, limit = 16384) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function body(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > 16384) throw new Error('请求内容过大');
  }
  return text ? JSON.parse(text) : {};
}

function send(response, status, value) {
  if (value?.error)
    value = {
      ...value,
      error: translateMessage(value.error, response.locadeLocale),
    };
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

export async function createApp({
  dataDir = process.env.LOCADE_DATA_DIR || path.join(os.homedir(), '.locade'),
  discoverProjects = discover,
  capturePage = capture,
  inspectProject = inspectUrl,
  openProjectDirectory = openDirectory,
  screenshotStatus = screenshotCapability,
  storageIO,
} = {}) {
  const release = await acquireInstance(dataDir);
  const store = new Store(dataDir, { io: storageIO });
  try {
    await store.init();
  } catch (error) {
    await release();
    throw error;
  }
  const token = randomUUID();
  const instance = randomUUID();
  const library = () => {
    const state = store.snapshot();
    return {
      ...state,
      projects: state.projects.map((project) => ({
        ...project,
        reviewKey: projectReviewKey(project),
      })),
      token,
      instance,
      application: 'locade',
      appVersion: APP_VERSION,
      dataDirectory: dataDir,
    };
  };
  let scanPending = null;
  const scan = (port) => {
    if (scanPending) return scanPending;
    scanPending = store
      .transaction(async () => {
        const result = await discoverProjects(
          port,
          store.state.projects.flatMap((item) =>
            item.endpoints.map((endpoint) => endpoint.url),
          ),
        );
        for (const project of store.state.projects) {
          project.online = false;
          for (const endpoint of project.endpoints) {
            endpoint.online = false;
            const check = result.checked?.find(
              (item) => urlKey(item.url) === urlKey(endpoint.url),
            );
            endpoint.status = check?.status || 'unknown';
            endpoint.reason = check?.reason || '最近探测未确认此地址';
          }
          project.status = project.endpoints.every(
            (endpoint) => endpoint.status === 'offline',
          )
            ? 'offline'
            : 'unknown';
          project.diagnostic = [
            ...new Set(project.endpoints.map((endpoint) => endpoint.reason)),
          ]
            .slice(0, 3)
            .join('；');
          project.identity = await refreshIdentity(project.identity);
        }
        for (const found of result.found)
          store.upsert(found, false, result.found);
        store.state.lastScan = new Date().toISOString();
        store.state.scanSource = result.source;
        store.state.scanLimited = !!result.limited;
        store.state.scanElapsedMs = result.elapsedMs ?? null;
      })
      .finally(() => {
        scanPending = null;
      });
    return scanPending;
  };
  const server = http.createServer(async (request, response) => {
    response.locadeLocale =
      normalizeLanguage(request.headers['x-locade-language']) || 'zh-CN';
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    const port = request.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    if (!hosts.includes(request.headers.host))
      return send(response, 403, { error: '不允许的 Host' });
    if (
      (request.headers.origin &&
        !hosts.some((host) => request.headers.origin === `http://${host}`)) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      return send(response, 403, { error: '不允许跨站访问' });
    }
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const pathname = decodeURIComponent(url.pathname);
      const opening = pathname.match(/^\/open\/([a-f0-9-]{36})$/);
      if (opening) {
        if (request.method !== 'GET')
          return send(response, 405, { error: '不支持的请求' });
        let target;
        await store.transaction(async () => {
          const project = store.state.projects.find(
            (item) => item.id === opening[1],
          );
          if (!project) throw new Error('项目不存在，请返回项目库');
          assertProjectAddress(project);
          const current = await inspectProject(
            localUrl(project.url, port).href,
          );
          target = verifyProjectPage(project, current, port);
          project.lastOpened = new Date().toISOString();
        });
        response.writeHead(302, {
          Location: target,
          'Cache-Control': 'no-store',
        });
        return response.end();
      }
      if (pathname.startsWith('/api/')) {
        if (request.method === 'GET' && pathname === '/api/health')
          return send(response, 200, {
            application: 'locade',
            instance,
            version: APP_VERSION,
          });
        if (request.method === 'GET' && pathname === '/api/library')
          return send(response, 200, library());
        if (request.method === 'GET' && pathname === '/api/storage')
          return send(response, 200, await store.storageUsage());
        if (request.method === 'GET' && pathname === '/api/capabilities')
          return send(response, 200, { screenshots: await screenshotStatus() });
        if (!['POST', 'PATCH', 'DELETE'].includes(request.method))
          return send(response, 404, { error: '接口不存在' });
        const supplied = Buffer.from(request.headers['x-locade-token'] || '');
        if (
          supplied.length !== token.length ||
          !timingSafeEqual(supplied, Buffer.from(token))
        ) {
          return send(response, 403, { error: '会话已过期，请刷新页面' });
        }
        if (pathname === '/api/backup' && request.method === 'POST') {
          const input = await body(request);
          let archive;
          await store.transaction(async () => {
            archive = await exportBackup(
              store,
              input.includeScreenshots === true,
            );
          });
          response.writeHead(200, {
            'Content-Type': 'application/gzip',
            'Cache-Control': 'no-store',
            'Content-Disposition':
              'attachment; filename="locade-backup.json.gz"',
          });
          return response.end(archive);
        }
        if (pathname === '/api/restore' && request.method === 'POST') {
          if (request.headers['x-locade-confirm'] !== 'replace-library')
            throw new Error('恢复需要明确确认替换资料库');
          const archive = parseBackup(await rawBody(request, MAX_BACKUP_BYTES));
          await restoreBackup(
            store,
            archive,
            request.headers['x-locade-images'] === 'include',
          );
          return send(response, 200, library());
        }
        if (pathname === '/api/storage/cleanup' && request.method === 'POST') {
          await body(request);
          await store.retryCleanup();
          return send(response, 200, library());
        }
        const input = await body(request);
        if (pathname === '/api/scan' && request.method === 'POST') {
          await scan(port);
          return send(response, 200, library());
        }
        await store.transaction(async () => {
          if (
            pathname === '/api/projects/visibility' &&
            request.method === 'POST'
          ) {
            updateVisibility(store, input.updates);
            return;
          }
          if (pathname === '/api/projects' && request.method === 'POST') {
            if (typeof input.url !== 'string' || input.url.length > 2048)
              throw new Error('请输入有效的本地地址');
            const target = localUrl(input.url, port);
            const found = await inspectProject(target.href);
            if (!found)
              throw new Error(
                '未找到可访问的 HTML 页面，请确认服务已启动；跳转和自签名证书暂不支持',
              );
            store.upsert(found, true);
            return;
          }
          if (pathname === '/api/settings' && request.method === 'PATCH') {
            if (
              input.screenshotsEnabled !== undefined &&
              typeof input.screenshotsEnabled !== 'boolean'
            )
              throw new Error('设置无效');
            if (
              input.autoRefresh !== undefined &&
              typeof input.autoRefresh !== 'boolean'
            )
              throw new Error('设置无效');
            if (input.screenshotsEnabled === false) {
              for (const project of store.state.projects)
                await store.deleteScreenshot(project);
            }
            if (input.screenshotsEnabled !== undefined)
              store.state.screenshotsEnabled = input.screenshotsEnabled;
            if (input.autoRefresh !== undefined)
              store.state.autoRefresh = input.autoRefresh;
            return;
          }
          if (pathname === '/api/screenshots' && request.method === 'DELETE') {
            for (const project of store.state.projects)
              await store.deleteScreenshot(project);
            return;
          }
          const match = pathname.match(
            /^\/api\/projects\/([a-f0-9-]{36})(?:\/(screenshot|opened|binding|open-directory))?$/,
          );
          const project =
            match && store.state.projects.find((item) => item.id === match[1]);
          if (!project) throw new Error('项目不存在');
          if (match[2] === 'binding' && request.method === 'POST') {
            const identity = await directoryIdentity(input.directory);
            if (
              store.state.projects.some(
                (item) =>
                  item.id !== project.id &&
                  item.identity?.key === identity.key &&
                  urlKey(item.url) === urlKey(project.url),
              )
            )
              throw new Error(
                '该目录已有同路径的项目，请先处理重复记录，不会自动合并',
              );
            if (project.identity?.key !== identity.key)
              await store.deleteScreenshot(project);
            project.identity = identity;
            project.bindingUnresolved = false;
            return;
          }
          if (match[2] === 'binding' && request.method === 'DELETE') {
            project.identity = null;
            project.bindingUnresolved = true;
            for (const endpoint of project.endpoints)
              endpoint.observation = null;
            await store.deleteScreenshot(project);
            return;
          }
          if (match[2] === 'open-directory' && request.method === 'POST') {
            if (!project.identity) throw new Error('请先关联项目目录');
            await openProjectDirectory(
              project.identity.directory,
              input.editor || 'finder',
            );
            return;
          }
          if (match[2] === 'screenshot' && request.method === 'POST') {
            if (
              !store.state.screenshotsEnabled ||
              project.captureAllowed === false
            )
              throw new Error('请先允许本机截图');
            if (project.hidden) throw new Error('已忽略的项目不能截图');
            assertProjectAddress(project);
            const current = structuredClone(await inspectProject(project.url));
            verifyProjectPage(project, current, port);
            await store.stageScreenshot(project, async (temporary) => {
              await capturePage(project.url, temporary, port);
              const after = await inspectProject(project.url);
              verifyProjectPage(project, after, port);
              if (
                (current.observation &&
                  current.observation !== after.observation) ||
                (current.identity &&
                  current.identity.key !== after.identity?.key)
              )
                throw new Error(
                  '端口所属项目已变化或暂时无法确认，请重新发现后操作',
                );
              if (
                current.title !== after.title &&
                !(
                  current.identity &&
                  current.identity.key === after.identity?.key
                )
              )
                throw new Error('页面身份可能已变化，请重新发现后操作');
            });
          } else if (match[2] === 'screenshot' && request.method === 'DELETE') {
            await store.deleteScreenshot(project);
          } else if (match[2] === 'opened' && request.method === 'POST') {
            assertProjectAddress(project);
            project.lastOpened = new Date().toISOString();
          } else if (!match[2] && request.method === 'PATCH') {
            validateProjectPatch(input);
            for (const field of ['hidden', 'captureAllowed']) {
              if (input[field] !== undefined) {
                if (typeof input[field] !== 'boolean')
                  throw new Error('设置无效');
                project[field] = input[field];
                if (field === 'captureAllowed' && !input[field])
                  await store.deleteScreenshot(project);
              }
            }
            if (input.favorite !== undefined) {
              if (typeof input.favorite !== 'boolean')
                throw new Error('收藏设置无效');
              project.favorite = input.favorite;
            }
            if (input.name !== undefined) {
              if (
                typeof input.name !== 'string' ||
                !input.name.trim() ||
                input.name.length > 100
              )
                throw new Error('名称需要 1–100 个字符');
              project.name = input.name.trim();
              project.renamed = true;
            }
          } else if (!match[2] && request.method === 'DELETE') {
            await store.deleteScreenshot(project);
            store.state.projects = store.state.projects.filter(
              (item) => item.id !== project.id,
            );
          } else throw new Error('不支持的操作');
        });
        return send(response, 200, library());
      }
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return send(response, 405, { error: '不支持的请求' });
      let file;
      if (/^\/screenshots\/[a-f0-9-]{36}\.png$/.test(pathname)) {
        const id = path.basename(pathname, '.png');
        const committed = store.snapshot();
        const project = committed.projects.find((item) => item.id === id);
        if (
          !committed.screenshotsEnabled ||
          !project?.screenshot ||
          project.captureAllowed === false
        ) {
          return send(response, 404, { error: '截图不存在' });
        }
        file = store.screenshotPath(project);
      } else if (pathname === '/navigation-error.css') {
        file = path.join(root, 'server/navigation-error.css');
      } else if (/^\/brand\/[a-z-]+\.svg$/.test(pathname)) {
        file = path.join(root, 'design/brand', path.basename(pathname));
      } else {
        const dist = path.join(root, 'dist');
        file = path.resolve(
          dist,
          `.${pathname === '/' ? '/index.html' : pathname}`,
        );
        if (!file.startsWith(`${dist}${path.sep}`))
          return send(response, 404, { error: '页面不存在' });
      }
      const content = await readFile(file);
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (
        request.url.startsWith('/open/') &&
        request.headers.accept?.includes('text/html')
      )
        return sendNavigationError(
          response,
          error.message || '当前项目无法打开，请重新发现。',
          normalizeLanguage(
            new URL(request.url, 'http://localhost').searchParams.get('lang'),
          ) ||
            normalizeLanguage(
              request.headers['accept-language']?.split(',')[0]?.split(';')[0],
            ) ||
            'zh-CN',
        );
      if (error.code === 'ENOENT')
        return send(response, request.url.startsWith('/api/') ? 400 : 404, {
          error: request.url.startsWith('/api/')
            ? '目录或本机文件不存在，请检查路径；截图备份缺文件时可仅导出元数据'
            : '文件不存在，请先运行 npm run build',
          ...(request.url.startsWith('/api/') ? { library: library() } : {}),
        });
      send(response, 400, {
        error: error.message || '操作失败',
        ...(request.url.startsWith('/api/') ? { library: library() } : {}),
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on('close', () => {
    store.pending.finally(release);
  });
  server.on('error', () => {
    release();
  });
  return { server, store, scan, release, instance };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT || 4400);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('PORT 必须为 0–65535（0 自动分配）');
  const { server, store, instance, release } = await createApp();
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `端口 ${port} 已占用，请设置 PORT=其他端口`
        : error.message,
    );
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const actualPort = server.address().port;
    writeFile(
      path.join(store.directory, 'runtime.json'),
      JSON.stringify({ pid: process.pid, port: actualPort, instance }),
      { mode: 0o600 },
    ).catch(console.error);
    console.log(
      `\n  Locade → http://127.0.0.1:${actualPort}\n  本机资料库：${store.directory}\n  不自动启动项目；截图默认关闭。\n`,
    );
  });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeIdleConnections();
    const deadline = setTimeout(() => process.exit(1), 30000);
    deadline.unref();
    await closed;
    await store.pending;
    await release();
    try {
      const record = JSON.parse(
        await readFile(path.join(store.directory, 'runtime.json'), 'utf8'),
      );
      if (record.instance === instance)
        await rm(path.join(store.directory, 'runtime.json'), { force: true });
    } catch {
      /* Another owner or already removed. */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  if (process.env.LOCADE_PARENT_PID) {
    const parentPid = Number(process.env.LOCADE_PARENT_PID);
    if (Number.isInteger(parentPid) && parentPid > 1)
      setInterval(() => {
        try {
          process.kill(parentPid, 0);
        } catch {
          shutdown();
        }
      }, 3000).unref();
  }
}
