import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateLibrary, urlKey } from './store.js';

export const MAX_BACKUP_BYTES = 48 * 1024 * 1024;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function exportBackup(store, includeScreenshots = false) {
  const state = structuredClone(store.state);
  const images = {};
  let bytes = 0;
  for (const item of state.projects) {
    if (
      includeScreenshots &&
      item.screenshot &&
      state.screenshotsEnabled &&
      item.captureAllowed
    ) {
      const image = await readFile(
        path.join(store.screenshots, `${item.id}.png`),
      );
      bytes += image.length;
      if (bytes > 24 * 1024 * 1024)
        throw new Error('截图备份超过 24 MB，请先清理截图或仅备份元数据');
      images[item.id] = image.toString('base64');
    } else item.screenshot = null;
    delete item.seenSession;
  }
  return gzipSync(
    JSON.stringify({
      format: 'locade-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      state,
      images,
    }),
  );
}

export function parseBackup(buffer) {
  if (buffer.length > MAX_BACKUP_BYTES) throw new Error('备份文件过大');
  let archive;
  try {
    const decoded =
      buffer[0] === 0x7b
        ? buffer.toString('utf8')
        : gunzipSync(buffer, { maxOutputLength: MAX_BACKUP_BYTES }).toString(
            'utf8',
          );
    archive = JSON.parse(decoded);
    if ([1, 2].includes(archive?.version) && Array.isArray(archive.projects))
      archive = {
        format: 'locade-backup',
        version: 1,
        state: archive,
        images: {},
      };
  } catch {
    throw new Error('备份不是有效的 Locade gzip 文件，或解压后超过 48 MB');
  }
  if (archive.format !== 'locade-backup' || archive.version !== 1)
    throw new Error('备份格式不受支持');
  validateLibrary(archive.state);
  if (
    !archive.images ||
    typeof archive.images !== 'object' ||
    Array.isArray(archive.images)
  )
    throw new Error('截图备份无效');
  let total = 0;
  const images = new Map();
  for (const [id, encoded] of Object.entries(archive.images)) {
    if (
      !archive.state.projects.some(
        (item) => item.id === id && item.screenshot,
      ) ||
      typeof encoded !== 'string' ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    )
      throw new Error('截图备份无效');
    const image = Buffer.from(encoded, 'base64');
    if (
      !image.subarray(0, 8).equals(PNG) ||
      image.length < 24 ||
      image.readUInt32BE(16) > 8192 ||
      image.readUInt32BE(20) > 8192 ||
      image.length > 8 * 1024 * 1024
    )
      throw new Error('备份含无效或过大 PNG');
    total += image.length;
    if (total > 24 * 1024 * 1024) throw new Error('备份图片过大');
    images.set(id, image);
  }
  return { state: archive.state, images };
}

export async function restoreBackup(store, archive, includeScreenshots) {
  const created = [];
  try {
    await store.transaction(async () => {
      await store.metadataCheckpoint();
      const projects = [];
      for (const previous of archive.state.projects) {
        const id = randomUUID();
        const screenshot =
          includeScreenshots &&
          previous.captureAllowed !== false &&
          archive.images.has(previous.id)
            ? previous.screenshot
            : null;
        if (screenshot) {
          const file = path.join(store.screenshots, `${id}.png`);
          await writeFile(file, archive.images.get(previous.id), {
            mode: 0o600,
            flag: 'wx',
          });
          created.push(file);
        }
        projects.push({
          id,
          name: previous.name,
          favorite: previous.favorite,
          url: previous.url,
          identity: previous.identity || null,
          endpoints: (previous.endpoints || [{ url: previous.url }]).map(
            (endpoint) => ({
              url: endpoint.url,
              online: false,
              observation: null,
              addressReused:
                endpoint.addressReused === true ||
                (previous.addressReused === true &&
                  urlKey(endpoint.url) === urlKey(previous.url)),
            }),
          ),
          screenshot,
          online: false,
          captureAllowed: previous.captureAllowed !== false,
          hidden: previous.hidden === true,
          addedAt: previous.addedAt || new Date().toISOString(),
          lastOpened: previous.lastOpened || null,
          lastSeen: previous.lastSeen || null,
          renamed: previous.renamed === true,
          restored: true,
        });
      }
      store.state = {
        version: 2,
        projects,
        screenshotsEnabled: !!includeScreenshots && archive.images.size > 0,
        autoRefresh: archive.state.autoRefresh !== false,
        lastScan: null,
      };
    });
  } catch (error) {
    await Promise.all(created.map((file) => rm(file, { force: true })));
    throw error;
  }
  await store.garbageCollect();
}
