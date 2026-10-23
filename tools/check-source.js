import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicFiles = new Set([
  '.gitignore',
  '.npmrc',
  '.prettierrc.json',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'SECURITY.md',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.js',
]);
const publicDirectories = new Set([
  '.github',
  'design',
  'docs',
  'macos',
  'server',
  'src',
  'tests',
  'tools',
]);
const excluded = new Set([
  '.git',
  '.build-cache',
  '.locade',
  '.DS_Store',
  'dist',
  'node_modules',
  'release',
  'test-results',
]);
const extensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.py',
  '.svg',
  '.swift',
  '.yml',
  '.yaml',
]);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reviewedImages = new Set([
  'design/brand/preview.png',
  'design/screenshots/library.png',
]);

export function validateLock(lock) {
  if (lock.lockfileVersion !== 3 || !lock.packages?.[''])
    throw new Error('依赖锁格式或根项目缺失');
  let count = 0;
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    const url = new URL(entry.resolved);
    if (
      !url.href.startsWith('https://registry.npmjs.org/') ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith('.tgz') ||
      !entry.version ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity)
    )
      throw new Error(`依赖必须锁定公共官方 HTTPS 包和 SHA512：${name}`);
    count++;
  }
  if (!count) throw new Error('依赖锁不能为空');
  return count;
}

export function validateNpmConfig(text) {
  const expected = new Map([
    ['registry', 'https://registry.npmjs.org/'],
    ['replace-registry-host', 'npmjs'],
    ['strict-ssl', 'true'],
  ]);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    if (index < 1 || expected.get(key) !== line.slice(index + 1).trim())
      throw new Error('项目 npm 配置只能含公共源、标准主机替换和 TLS 校验');
    expected.delete(key);
  }
  if (expected.size) throw new Error('缺少公共安装配置');
}

export function inspectPublicText(text) {
  const findings = [];
  const patterns = [
    ['个人主目录', /\/(?:Users|home)\/(?!you(?:\/|\b)|Shared(?:\/|\b))[\w.-]+/],
    ['私钥', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
    [
      'GitHub 凭据',
      /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
    ],
    ['云访问密钥', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['API 密钥', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/],
  ];
  for (const [label, pattern] of patterns)
    if (pattern.test(text)) findings.push(label);
  return findings;
}

export async function publicManifest(root) {
  const files = [];
  async function visit(relative, rootFile = false) {
    const absolute = path.join(root, relative);
    const info = await lstat(absolute);
    if (info.isSymbolicLink())
      throw new Error(`公开源码不接受链接：${relative}`);
    const name = path.basename(relative);
    if (info.isDirectory()) {
      if (relative.includes('/') && name.startsWith('.'))
        throw new Error(`嵌套隐藏目录需要人工审核：${relative}`);
      for (const child of (await readdir(absolute)).sort())
        await visit(`${relative}/${child}`);
      return;
    }
    if (!info.isFile()) throw new Error(`不是普通源码文件：${relative}`);
    if (name === '.DS_Store') return;
    const preview = reviewedImages.has(relative);
    if (
      !rootFile &&
      (!extensions.has(path.extname(name)) || name.startsWith('.')) &&
      !preview
    )
      throw new Error(`未审核的公开文件类型：${relative}`);
    const bytes = await readFile(absolute);
    const findings = preview ? [] : inspectPublicText(bytes.toString('utf8'));
    if (findings.length)
      throw new Error(`公开文件需脱敏：${relative}（${findings.join('、')}）`);
    files.push({ file: relative, bytes: bytes.length, sha256: hash(bytes) });
  }
  for (const name of (await readdir(root)).sort()) {
    if (excluded.has(name)) continue;
    if (publicFiles.has(name)) {
      const info = await lstat(path.join(root, name));
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error(`公开根文件必须是普通文件：${name}`);
      await visit(name, true);
    } else if (publicDirectories.has(name)) {
      const info = await lstat(path.join(root, name));
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error(`公开源码目录无效：${name}`);
      await visit(name);
    } else {
      throw new Error(`未审核的根目录内容：${name}`);
    }
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return {
    sha256: hash(
      files.map((file) => `${file.file}\0${file.sha256}\0`).join(''),
    ),
    files,
  };
}

export async function checkSource(root) {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json')));
  const dependencies = validateLock(lock);
  validateNpmConfig(await readFile(path.join(root, '.npmrc'), 'utf8'));
  return { dependencies, ...(await publicManifest(root)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--json'))
      throw new Error('用法：node tools/check-source.js [--json]');
    const manifest = await checkSource(
      fileURLToPath(new URL('../', import.meta.url)),
    );
    console.log(
      process.argv.includes('--json')
        ? JSON.stringify(manifest, null, 2)
        : `公开源码检查通过：${manifest.files.length} 文件，${manifest.dependencies} 个公共锁定包\nSHA256 ${manifest.sha256}\n有限规则不替代人工秘密 / 图片审查；不代表已经发布或通过全部验收。`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
