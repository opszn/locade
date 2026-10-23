import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  releasePaths,
  assertReleaseDirectory,
  sourceManifest,
  verifyPackagedSources,
} from './macos-release.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const paths = releasePaths(root);
await assertReleaseDirectory(paths);
const { app } = paths;
const runtime = path.join(app, 'Contents/Resources/Runtime');
await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
console.log('✓ .app 资源封装与代码签名完整性（不等于公证/系统信任）');
const { stdout: linked } = await exec('/usr/bin/otool', [
  '-L',
  path.join(runtime, 'node'),
]);
assert.ok(
  linked
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .every((line) => /^\s+\/(System|usr\/lib)\//.test(line)),
);
console.log('✓ 内置 Node 仅依赖系统动态库，无 Homebrew 路径');
const manifest = JSON.parse(
  await readFile(path.join(app, 'Contents/Resources/BUILD.json')),
);
if (manifest.sources) {
  const count = await verifyPackagedSources(app, manifest.sources);
  assert.equal(
    manifest.sources.sha256,
    (await sourceManifest(root)).sha256,
    '候选包必须对应当前冻结源码',
  );
  console.log(`✓ 包内 ${count} 个服务端 / Web 文件与冻结源码指纹一致`);
} else console.log('! 旧包没有源码指纹；静态完整性不证明包含最新修复');
const originalNode = path.join(
  root,
  `.build-cache/node-${manifest.node}-darwin-${manifest.arch}/bin/node`,
);
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
assert.equal(
  digest(await readFile(path.join(runtime, 'node'))),
  digest(await readFile(originalNode)),
);
console.log('✓ 保留官方 Node 原始二进制及其签名');
for (const file of [
  'server/index.js',
  'dist/index.html',
  'browser/chrome-headless-shell',
  'node_modules/playwright-core/package.json',
  'NODE-LICENSE.txt',
])
  assert.ok((await stat(path.join(runtime, file))).isFile());
for (const file of ['Locade.icns', 'wordmark.png', 'menubar.png'])
  assert.ok((await stat(path.join(app, 'Contents/Resources', file))).isFile());
console.log('✓ 服务端、Web、匹配浏览器、品牌资源与许可说明齐全');
const { stdout: size } = await exec('/usr/bin/du', ['-sk', app]);
console.log(
  `本机应用体积：${(Number(size.split(/\s+/)[0]) / 1024).toFixed(1)} MiB（非轻量壳体大小）`,
);
