import { open, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function acquireInstance(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'instance.lock');
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          if (JSON.parse(await readFile(file, 'utf8')).nonce === nonce)
            await rm(file);
        } catch {
          /* Already released. */
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try {
        previous = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        throw new Error(
          '实例锁损坏；确认 Locade 未运行后手动移除 instance.lock',
        );
      }
      if (!Number.isInteger(previous.pid) || previous.pid < 1)
        throw new Error('实例锁无效');
      try {
        process.kill(previous.pid, 0);
      } catch (check) {
        if (check.code === 'ESRCH') {
          // Never remove a lock that another process replaced while we checked it.
          if ((await readFile(file, 'utf8')) === JSON.stringify(previous)) {
            await rm(file);
            continue;
          }
        }
      }
      throw new Error(
        '此资料库已有 Locade 实例运行，请使用现有入口或另选 LOCADE_DATA_DIR',
      );
    }
  }
  throw new Error('无法取得实例锁');
}
