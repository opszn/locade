import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_VERSION } from '../server/version.js';
import {
  releasePaths,
  assertReleaseDirectory,
  assertNewOutput,
} from './macos-release.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const paths = releasePaths(root);
await assertReleaseDirectory(paths);
const { release, staging, app } = paths;
const dmg = path.join(release, `Locade-${APP_VERSION}-${process.arch}.dmg`);
await assertNewOutput(dmg);
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(app, path.join(staging, 'Locade.app'), {
  recursive: true,
});
await cp(
  path.join(root, 'docs/MACOS_ALPHA2_PREVIEW.md'),
  path.join(staging, '请先阅读.txt'),
);
await exec('/bin/ln', [
  '-s',
  '/Applications',
  path.join(staging, 'Applications'),
]);
await exec(
  '/usr/bin/hdiutil',
  [
    'create',
    '-volname',
    `Locade ${APP_VERSION}`,
    '-srcfolder',
    staging,
    '-format',
    'UDZO',
    dmg,
  ],
  { timeout: 180000, maxBuffer: 1024 * 1024 },
);
console.log('本地预览 DMG 已生成；未签名公证，不用于公开发布。');
