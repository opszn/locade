import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseListeners, processIdentity } from './identity.js';

const exec = promisify(execFile);
const fallbackPorts = [
  3000, 3001, 3002, 4000, 4200, 4321, 5000, 5173, 5174, 5500, 6006, 8000, 8080,
  8081, 8888, 9000,
];

export function localUrl(input, excludedPort) {
  const url = new URL(input);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('仅支持 localhost、127.0.0.1 或 [::1] 的 HTTP(S) 地址');
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (port === excludedPort) throw new Error('不能添加 Locade 自身');
  url.hash = '';
  return url;
}

export function parseListeningPorts(output) {
  return [
    ...new Set(
      output
        .split('\n')
        .filter((line) => line.startsWith('n'))
        .map((line) => Number(line.match(/:(\d+)\s*$/)?.[1]))
        .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535),
    ),
  ];
}

export async function listeningPorts() {
  try {
    const { stdout } = await exec(
      'lsof',
      ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'],
      {
        timeout: 4000,
        maxBuffer: 1024 * 1024,
      },
    );
    return {
      ports: parseListeningPorts(stdout),
      listeners: parseListeners(stdout),
      source: 'lsof',
    };
  } catch (error) {
    if (error.code === 1 && !error.stdout && !error.stderr)
      return { ports: [], source: 'lsof' };
    return { ports: fallbackPorts, source: '常用端口（lsof 不可用）' };
  }
}

export async function listenersOnPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
  try {
    const { stdout } = await exec(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'],
      { timeout: 1500, maxBuffer: 65536 },
    );
    return parseListeners(stdout).filter((item) => item.port === port);
  } catch {
    return [];
  }
}

const portOf = (value) => {
  const url = new URL(value);
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
};

function soleOwner(listeners, port) {
  const owners = new Set(
    (listeners || [])
      .filter(
        (item) =>
          item.port === port && Number.isInteger(item.pid) && item.pid > 0,
      )
      .map((item) => item.pid),
  );
  return owners.size === 1 ? owners.values().next().value : null;
}

async function currentOwner(inspectListeners, port) {
  try {
    return soleOwner(await inspectListeners(port), port);
  } catch {
    return null;
  }
}

async function verifiedMetadata(
  port,
  initialOwner,
  inspectListeners,
  identifyProcess,
  mayContinue = () => true,
) {
  if (!initialOwner || !mayContinue()) return null;
  if ((await currentOwner(inspectListeners, port)) !== initialOwner)
    return null;
  if (!mayContinue()) return null;
  let metadata;
  try {
    metadata = await identifyProcess(initialOwner);
  } catch {
    return null;
  }
  if (!metadata?.observation || !mayContinue()) return null;
  // A live PID alone is not proof it still owns the page's listener.
  if ((await currentOwner(inspectListeners, port)) !== initialOwner)
    return null;
  return metadata;
}

export async function mapLimit(items, concurrency, task) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        result[index] = await task(items[index]);
      }
    }),
  );
  return result;
}

// No redirects: discovering a local service must not turn into a remote request.
export function probe(input, timeout = 1200, onFailure = () => {}) {
  const url = localUrl(input);
  return new Promise((resolve) => {
    let settled = false;
    let failure = { status: 'unknown', reason: '未收到有效 HTML' };
    const finish = (value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (!value) onFailure(failure);
        resolve(value);
      }
    };
    const request = (url.protocol === 'https:' ? https : http).get(
      url,
      {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'Locade/0.3 (local discovery)',
        },
        lookup: (_hostname, options, callback) =>
          callback(
            null,
            options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1',
            4,
          ),
      },
      (response) => {
        const isHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(
          response.headers['content-type'] || '',
        );
        if (
          !isHtml ||
          response.statusCode >= 400 ||
          response.statusCode < 200 ||
          response.statusCode >= 300
        ) {
          failure = {
            status: 'error',
            reason:
              response.statusCode >= 300 && response.statusCode < 400
                ? '页面重定向：请添加最终本地地址'
                : response.statusCode >= 400
                  ? `HTTP ${response.statusCode}`
                  : '不是成功 HTML 响应',
          };
          response.destroy();
          finish(null);
          return;
        }
        let body = '';
        const complete = () => {
          const title = body
            .match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100);
          finish({
            url: url.href,
            title:
              title ||
              `Local project :${url.port || (url.protocol === 'https:' ? 443 : 80)}`,
          });
        };
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length >= 32768) {
            complete();
            response.destroy();
          }
        });
        response.on('end', complete);
        response.on('error', () => {
          failure = { status: 'error', reason: '读取页面失败' };
          finish(null);
        });
      },
    );
    const timer = setTimeout(() => {
      failure = { status: 'unknown', reason: '网页探测超时' };
      request.destroy();
      finish(null);
    }, timeout);
    request.on('error', (error) => {
      failure = {
        status: ['ECONNREFUSED', 'ECONNRESET'].includes(error.code)
          ? 'offline'
          : 'error',
        reason:
          error.code === 'ECONNREFUSED'
            ? '连接被拒绝，服务可能已关闭'
            : '连接或 HTTPS 证书错误',
      };
      finish(null);
    });
  });
}

export async function discover(
  excludedPort,
  knownUrls = [],
  {
    inventory = listeningPorts,
    inspectListeners = listenersOnPort,
    identifyProcess = processIdentity,
  } = {},
) {
  const started = Date.now();
  const deadline = started + 15000;
  let budgetLimited = false;
  const checked = [];
  const { ports, listeners = [], source } = await inventory();
  const candidates = ports
    .filter((port) => port !== excludedPort)
    .slice(0, 128);
  const found = await mapLimit(candidates, 8, async (port) => {
    for (const host of ['127.0.0.1', '[::1]']) {
      if (Date.now() > deadline) {
        budgetLimited = true;
        return null;
      }
      const result =
        (await probe(`http://${host}:${port}/`)) ||
        (await probe(`https://${host}:${port}/`));
      if (result) return result;
    }
    return null;
  });
  const known = await mapLimit(
    [...new Set(knownUrls)].slice(0, 256),
    8,
    async (url) => {
      try {
        // A saved endpoint can become our management port after a restart.
        localUrl(url, excludedPort);
        if (Date.now() > deadline) {
          budgetLimited = true;
          checked.push({
            url,
            status: 'unknown',
            reason: '本轮探测预算已用尽，请稍后刷新',
          });
          return null;
        }
        const result = await probe(url, 1200, (failure) =>
          checked.push({ url, ...failure }),
        );
        return result;
      } catch {
        return null;
      }
    },
  );
  const pages = [...found.filter(Boolean), ...known.filter(Boolean)];
  const metadata = new Map();
  const confirmed = new Map();
  const identify = (pid) => {
    if (!metadata.has(pid)) metadata.set(pid, identifyProcess(pid));
    return metadata.get(pid);
  };
  const mayContinue = () => {
    if (Date.now() <= deadline) return true;
    budgetLimited = true;
    return false;
  };
  // Check ownership after all HTTP responses, once per port rather than route.
  await mapLimit(
    [...new Set(pages.map((page) => portOf(page.url)))],
    8,
    async (port) => {
      const details = await verifiedMetadata(
        port,
        soleOwner(listeners, port),
        inspectListeners,
        identify,
        mayContinue,
      );
      if (details) confirmed.set(port, details);
    },
  );
  return {
    found: pages.map((page) => ({
      ...page,
      ...confirmed.get(portOf(page.url)),
    })),
    source,
    limited: ports.length > 128 || budgetLimited || knownUrls.length > 256,
    elapsedMs: Date.now() - started,
    checked,
  };
}

export async function inspectUrl(
  url,
  {
    inspectListeners = listenersOnPort,
    identifyProcess = processIdentity,
  } = {},
) {
  const target = localUrl(url);
  const port = portOf(target.href);
  const initialOwner = await currentOwner(inspectListeners, port);
  const found = await probe(target.href);
  if (!found) return null;
  const details = await verifiedMetadata(
    port,
    initialOwner,
    inspectListeners,
    identifyProcess,
  );
  return { ...found, ...details };
}
