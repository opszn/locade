import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const exec = promisify(execFile);
const markers = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'index.html',
];

export async function smallFile(file, limit = 65536) {
  const handle = await open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('不是普通文件');
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw new Error('元数据文件过大');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

export const directoryKey = (directory) =>
  createHash('sha256').update(directory).digest('hex');
const exists = async (file) => {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
};

// Read Git metadata only. Never invoke hooks, filters, shell configuration or project scripts.
export async function directoryIdentity(input, source = 'manual') {
  if (
    typeof input !== 'string' ||
    input.length > 4096 ||
    !path.isAbsolute(input) ||
    input.includes('\0')
  )
    throw new Error('请输入已存在的绝对目录路径');
  const directory = await realpath(input);
  if (!(await stat(directory)).isDirectory())
    throw new Error('项目路径不是目录');
  if ([path.parse(directory).root, os.homedir()].includes(directory))
    throw new Error('请选择具体项目目录，而不是磁盘或个人目录');
  let cursor = directory;
  let worktree = null;
  let gitDir = null;
  let branch = null;
  for (let level = 0; level < 32; level++) {
    const dotgit = path.join(cursor, '.git');
    if (await exists(dotgit)) {
      worktree = cursor;
      try {
        const info = await stat(dotgit);
        gitDir = info.isDirectory()
          ? await realpath(dotgit)
          : await realpath(
              path.resolve(
                cursor,
                (await smallFile(dotgit, 4096))
                  .trim()
                  .replace(/^gitdir:\s*/, ''),
              ),
            );
        const head = (await smallFile(path.join(gitDir, 'HEAD'), 1024)).trim();
        branch = head.startsWith('ref: refs/heads/')
          ? head.slice(16)
          : /^[0-9a-f]{40,64}$/i.test(head)
            ? `detached:${head.slice(0, 8)}`
            : null;
      } catch {
        gitDir = null;
      }
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor || cursor === os.homedir()) break;
    cursor = parent;
  }
  return {
    directory,
    key: directoryKey(directory),
    worktree,
    branch,
    source,
    available: true,
  };
}

export async function detectDirectory(cwd) {
  if (!cwd) return null;
  let cursor;
  try {
    cursor = await realpath(cwd);
  } catch {
    return null;
  }
  for (let level = 0; level < 16; level++) {
    if (cursor === os.homedir() || cursor === path.parse(cursor).root) break;
    if (
      (
        await Promise.all(
          markers.map((marker) => exists(path.join(cursor, marker))),
        )
      ).some(Boolean) ||
      (await exists(path.join(cursor, '.git')))
    ) {
      try {
        return await directoryIdentity(cursor, 'auto');
      } catch {
        return null;
      }
    }
    cursor = path.dirname(cursor);
  }
  return null;
}

export function parseListeners(output) {
  const listeners = [];
  let pid = null;
  for (const line of output.split('\n')) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
    if (line.startsWith('n') && pid) {
      const port = Number(line.match(/:(\d+)\s*$/)?.[1]);
      if (
        port > 0 &&
        port <= 65535 &&
        !listeners.some((item) => item.pid === pid && item.port === port)
      )
        listeners.push({ pid, port });
    }
  }
  return listeners;
}

export async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid < 1)
    return { identity: null, observation: null };
  try {
    const [{ stdout: cwdOutput }, { stdout: started }] = await Promise.all([
      exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
        timeout: 1500,
        maxBuffer: 16384,
      }),
      exec('ps', ['-p', String(pid), '-o', 'lstart='], {
        timeout: 1500,
        maxBuffer: 4096,
      }),
    ]);
    if (!started.trim()) return { identity: null, observation: null };
    const cwd = cwdOutput
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1);
    return {
      identity: await detectDirectory(cwd),
      observation: `${pid}:${started.trim()}`,
    };
  } catch {
    return { identity: null, observation: null };
  }
}

export async function refreshIdentity(identity) {
  if (!identity) return null;
  try {
    return await directoryIdentity(identity.directory, identity.source);
  } catch {
    return { ...identity, available: false, branch: null };
  }
}
