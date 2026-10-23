import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { directoryIdentity } from './identity.js';

const exec = promisify(execFile);
export async function openDirectory(directory, editor = 'finder') {
  if (process.platform !== 'darwin')
    throw new Error('打开目录与编辑器当前仅支持 macOS');
  const identity = await directoryIdentity(directory);
  const applications = { vscode: 'Visual Studio Code', cursor: 'Cursor' };
  if (editor !== 'finder' && !Object.hasOwn(applications, editor))
    throw new Error('仅支持 Finder、VS Code 或 Cursor');
  const args =
    editor === 'finder'
      ? [pathToFileURL(identity.directory).href]
      : ['-a', applications[editor], pathToFileURL(identity.directory).href];
  try {
    await exec('/usr/bin/open', args, { timeout: 5000, maxBuffer: 4096 });
  } catch {
    throw new Error('无法打开所选应用，请确认已安装；也可改用 Finder');
  }
}
