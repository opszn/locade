import { lstat, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function releasePaths(root, environment = process.env) {
  const base = path.join(root, 'release');
  const release = environment.LOCADE_RELEASE_DIR
    ? path.resolve(root, environment.LOCADE_RELEASE_DIR)
    : base;
  const relative = path.relative(base, release);
  if (
    relative &&
    (!/^[a-z0-9][a-z0-9-]*$/.test(relative) || relative.length > 64)
  )
    throw new Error(
      'LOCADE_RELEASE_DIR 只能指定 release 下的独立候选目录（小写字母、数字、连字符）',
    );
  const label = relative.replaceAll(path.sep, '-');
  const suffix = label ? `-${label}` : '';
  return {
    base,
    release,
    label,
    app: path.join(release, 'Locade.app'),
    staging: path.join(root, `.build-cache/dmg${suffix}`),
    validationRoot: path.join(root, `.build-cache/install-validation${suffix}`),
    report: (name) => path.join(root, `test-results/${name}${suffix}.json`),
  };
}

export async function assertReleaseDirectory(paths) {
  let cursor = paths.base;
  const segments = path
    .relative(paths.base, paths.release)
    .split(path.sep)
    .filter(Boolean);
  for (let index = 0; index <= segments.length; index++) {
    try {
      const info = await lstat(cursor);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('候选输出目录不能是链接或文件');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (index < segments.length) cursor = path.join(cursor, segments[index]);
  }
}

export async function assertNewOutput(file) {
  try {
    await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(
    `输出已存在，不覆盖已有文件身份：${file}。请明确选择新的固定候选目录。`,
  );
}

const digest = (content) => createHash('sha256').update(content).digest('hex');
async function filesUnder(root, file) {
  const full = path.join(root, file);
  const info = await lstat(full);
  if (info.isSymbolicLink()) throw new Error(`源码清单不接受链接：${file}`);
  if (info.isFile())
    return [{ file, bytes: info.size, sha256: digest(await readFile(full)) }];
  if (!info.isDirectory()) throw new Error(`不是源码文件：${file}`);
  const entries = await readdir(full);
  return (
    await Promise.all(
      entries
        .sort()
        .filter((name) => !name.startsWith('.'))
        .map((name) => filesUnder(root, `${file}/${name}`)),
    )
  ).flat();
}

export async function sourceManifest(root) {
  const files = (
    await Promise.all(
      [
        'package.json',
        'package-lock.json',
        'macos/Locade.swift',
        'server',
        'src',
        'dist',
      ].map((file) => filesUnder(root, file)),
    )
  )
    .flat()
    .sort((a, b) => a.file.localeCompare(b.file));
  const sha256 = digest(
    files.map((file) => `${file.file}\0${file.sha256}\0`).join(''),
  );
  return { sha256, files };
}

export async function verifyPackagedSources(app, sources) {
  if (!sources?.files?.length) throw new Error('缺少可追溯源码清单');
  const runtime = path.join(app, 'Contents/Resources/Runtime');
  const packaged = (
    await Promise.all(
      ['server', 'dist'].map((file) => filesUnder(runtime, file)),
    )
  )
    .flat()
    .sort((a, b) => a.file.localeCompare(b.file));
  const expected = sources.files.filter((file) =>
    /^(server|dist)\//.test(file.file),
  );
  if (JSON.stringify(packaged) !== JSON.stringify(expected))
    throw new Error('包内服务端 / Web 与构建源码清单不一致');
  return packaged.length;
}
