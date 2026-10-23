import {
  mkdir,
  readFile,
  writeFile,
  cp,
  rm,
  chmod,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { APP_VERSION, BUNDLE_VERSION } from '../server/version.js';
import {
  releasePaths,
  assertReleaseDirectory,
  assertNewOutput,
  sourceManifest,
} from './macos-release.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const arch = process.arch;
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch))
  throw new Error('此构建脚本需要 macOS arm64 / x64');
const paths = releasePaths(root);
const { release, app } = paths;
await assertReleaseDirectory(paths);
await assertNewOutput(app);
const resources = path.join(app, 'Contents', 'Resources');
const runtime = path.join(resources, 'Runtime');
const cache = path.join(root, '.build-cache');
const nodeVersion = 'v24.22.0';
const archiveName = `node-${nodeVersion}-darwin-${arch}.tar.gz`;
await mkdir(cache, { recursive: true });
const archiveFile = path.join(cache, archiveName);
console.log(`校验官方 Node ${nodeVersion} (${arch})…`);
const { stdout: checksums } = await exec(
  '/usr/bin/curl',
  [
    '-fsSL',
    '--retry',
    '2',
    '--max-time',
    '45',
    `https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`,
  ],
  { timeout: 150000 },
);
const expected = checksums
  .split('\n')
  .find((line) => line.endsWith(`  ${archiveName}`))
  ?.split(/\s+/)[0];
if (!expected) throw new Error('未找到匹配的 Node 校验和');
let archive;
try {
  archive = await readFile(archiveFile);
} catch {
  /* Download below. */
}
if (
  !archive ||
  createHash('sha256').update(archive).digest('hex') !== expected
) {
  await exec(
    '/usr/bin/curl',
    [
      '-fsSL',
      '--retry',
      '1',
      '--max-time',
      '900',
      '-C',
      '-',
      `https://nodejs.org/dist/${nodeVersion}/${archiveName}`,
      '-o',
      `${archiveFile}.download`,
    ],
    { timeout: 1820000 },
  );
  archive = await readFile(`${archiveFile}.download`);
  if (createHash('sha256').update(archive).digest('hex') !== expected)
    throw new Error('Node 运行时校验失败');
  await writeFile(archiveFile, archive);
  await rm(`${archiveFile}.download`, { force: true });
}
const nodeRoot = path.join(cache, `node-${nodeVersion}-darwin-${arch}`);
const { stdout: officialNode } = await exec(
  '/usr/bin/tar',
  ['-xOf', archiveFile, `node-${nodeVersion}-darwin-${arch}/bin/node`],
  { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 },
);
let cachedNode;
try {
  cachedNode = await readFile(path.join(nodeRoot, 'bin/node'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (cachedNode) {
  if (
    createHash('sha256').update(cachedNode).digest('hex') !==
    createHash('sha256').update(officialNode).digest('hex')
  )
    throw new Error('缓存 Node 与已验证官方归档不一致，保留原文件待检查');
} else await exec('/usr/bin/tar', ['-xzf', archiveFile, '-C', cache]);
const browsers = JSON.parse(
  await readFile(path.join(root, 'node_modules/playwright-core/browsers.json')),
);
const revision = browsers.browsers.find(
  (browser) => browser.name === 'chromium-headless-shell',
).revision;
const platformArch = arch === 'x64' ? 'x64' : 'arm64';
const browserSource = path.join(
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
  `chromium_headless_shell-${revision}`,
  `chrome-headless-shell-mac-${platformArch}`,
);
try {
  await stat(path.join(browserSource, 'chrome-headless-shell'));
} catch {
  throw new Error('缺少匹配截图浏览器。先运行 npx playwright install chromium');
}

await exec(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'],
  { cwd: root },
);
await mkdir(release, { recursive: true });
const sources = await sourceManifest(root);
await mkdir(app);
await mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
await mkdir(runtime, { recursive: true });
for (const directory of ['server', 'dist', 'design/brand'])
  await cp(path.join(root, directory), path.join(runtime, directory), {
    recursive: true,
  });
await cp(path.join(nodeRoot, 'bin/node'), path.join(runtime, 'node'));
await cp(
  path.join(nodeRoot, 'LICENSE'),
  path.join(runtime, 'NODE-LICENSE.txt'),
);
await writeFile(
  path.join(runtime, 'package.json'),
  JSON.stringify({
    private: true,
    type: 'module',
    version: APP_VERSION,
    license: 'MIT',
  }),
);
await cp(path.join(root, 'LICENSE'), path.join(runtime, 'LICENSE'));
for (const name of ['playwright', 'playwright-core'])
  await cp(
    path.join(root, 'node_modules', name),
    path.join(runtime, 'node_modules', name),
    { recursive: true },
  );
await cp(browserSource, path.join(runtime, 'browser'), { recursive: true });
for (const name of ['react', 'react-dom'])
  await cp(
    path.join(root, 'node_modules', name, 'LICENSE'),
    path.join(runtime, `${name}-LICENSE.txt`),
  );
await writeFile(
  path.join(resources, 'BUILD.json'),
  JSON.stringify(
    {
      version: APP_VERSION,
      node: nodeVersion,
      nodeArchiveSHA256: expected,
      chromiumRevision: revision,
      arch,
      builtAt: new Date().toISOString(),
      signing: 'ad-hoc; not notarized',
      sources,
    },
    null,
    2,
  ),
);
await chmod(path.join(runtime, 'node'), 0o755);

console.log('从现有 SVG 生成应用图标（不修改品牌源文件）…');
const iconset = path.join(cache, 'Locade.iconset');
await mkdir(iconset, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: path.join(browserSource, 'chrome-headless-shell'),
});
try {
  const page = await browser.newPage();
  const svg = await readFile(
    path.join(root, 'design/brand/locade-app-icon.svg'),
    'utf8',
  );
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${svg}`,
  );
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      await page.setViewportSize({ width: size * scale, height: size * scale });
      await page.screenshot({
        path: path.join(
          iconset,
          `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`,
        ),
        omitBackground: true,
      });
    }
  }
  const mono = await readFile(
    path.join(root, 'design/brand/locade-icon-mono.svg'),
    'utf8',
  );
  await page.setViewportSize({ width: 38, height: 38 });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${mono}`,
  );
  await page.screenshot({
    path: path.join(resources, 'menubar.png'),
    omitBackground: true,
  });
  const wordmark = await readFile(
    path.join(root, 'design/brand/locade-wordmark.svg'),
    'utf8',
  );
  await page.setViewportSize({ width: 264, height: 80 });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${wordmark}`,
  );
  await page.screenshot({
    path: path.join(resources, 'wordmark.png'),
    omitBackground: true,
  });
} finally {
  await browser.close();
}
await exec('/usr/bin/iconutil', [
  '-c',
  'icns',
  iconset,
  '-o',
  path.join(resources, 'Locade.icns'),
]);
await writeFile(
  path.join(app, 'Contents/Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Locade</string><key>CFBundleIdentifier</key><string>local.locade.prototype</string>
<key>CFBundleName</key><string>Locade</string><key>CFBundleDisplayName</key><string>Locade</string>
<key>CFBundleVersion</key><string>3</string><key>CFBundleShortVersionString</key><string>${BUNDLE_VERSION}</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconFile</key><string>Locade</string>
<key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>`,
);
console.log('编译菜单栏应用…');
await exec(
  '/usr/bin/swiftc',
  [
    '-parse-as-library',
    '-swift-version',
    '5',
    '-O',
    '-target',
    `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macosx13.0`,
    path.join(root, 'macos/Locade.swift'),
    '-o',
    path.join(app, 'Contents/MacOS/Locade'),
  ],
  { timeout: 180000, maxBuffer: 1024 * 1024 },
);
if ((await sourceManifest(root)).sha256 !== sources.sha256)
  throw new Error(
    '构建期间源码发生变化，保留候选产物待检查，不签名或覆盖原应用',
  );
// Preserve upstream runtime signatures; --deep --force would replace them with ad-hoc signatures.
await exec('/usr/bin/codesign', ['--force', '--sign', '-', app], {
  timeout: 180000,
  maxBuffer: 1024 * 1024,
});
await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
console.log(`完成：${app}\n本机 ad-hoc 签名，未公证；不要当作已公开分发版本。`);
