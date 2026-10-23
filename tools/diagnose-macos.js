import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { releasePaths, assertReleaseDirectory } from './macos-release.js';
import {
  signatureDetails,
  policyStatus,
  readCommand,
} from './macos-diagnostics.js';

if (process.platform !== 'darwin')
  throw new Error('macOS 诊断仅在 macOS 上可用');
const root = fileURLToPath(new URL('../', import.meta.url));
const paths = releasePaths(root);
await assertReleaseDirectory(paths);
const { app } = paths;
const runtime = path.join(app, 'Contents/Resources/Runtime');
const manifest = JSON.parse(
  await readFile(path.join(app, 'Contents/Resources/BUILD.json')),
);
const digest = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const integrity = await readCommand('/usr/bin/codesign', [
  '--verify',
  '--deep',
  '--strict',
  app,
]);
const policy = await readCommand('/usr/sbin/spctl', [
  '--assess',
  '--type',
  'execute',
  app,
]);
const system = await readCommand('/usr/bin/sw_vers', ['-productVersion']);
const report = {
  generatedAt: new Date().toISOString(),
  macOS: system.ok ? system.output.trim() : null,
  arch: manifest.arch,
  appVersion: manifest.version,
  sourceSHA256: manifest.sources?.sha256 || null,
  integrityValid: integrity.ok,
  executionPolicy: policyStatus(policy),
  policyExitCode: policy.code,
  signatures: {},
  bundledNodeMatchesOfficial: false,
  runtimeTests: 'not-run-by-diagnostics',
};
for (const [name, file] of Object.entries({
  app,
  node: path.join(runtime, 'node'),
  chromium: path.join(runtime, 'browser/chrome-headless-shell'),
})) {
  const result = await readCommand('/usr/bin/codesign', ['-dvv', file]);
  report.signatures[name] = {
    readable: result.ok,
    ...signatureDetails(result.output),
  };
}
report.bundledNodeMatchesOfficial =
  (await digest(path.join(runtime, 'node'))) ===
  (await digest(
    path.join(
      root,
      `.build-cache/node-${manifest.node}-darwin-${manifest.arch}/bin/node`,
    ),
  ));
await mkdir(path.join(root, 'test-results'), { recursive: true });
await writeFile(
  paths.report('macos-diagnostics'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
console.log(
  '只读检查；未启动应用、访问钥匙串、修改签名 / 安全属性或改变系统设置。',
);
if (report.executionPolicy !== 'accepted')
  console.log(
    'Gatekeeper 分发评估未接受此构建；这不等同于本机进程管控结果，实际运行以 test:mac 为准。用户放行后本机构建可能正常运行，公开分发仍需签名 / 公证验证。',
  );
if (
  !report.integrityValid ||
  !report.bundledNodeMatchesOfficial ||
  report.executionPolicy !== 'accepted'
)
  process.exitCode = 1;
