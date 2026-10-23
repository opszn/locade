import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  chmod,
  readdir,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { localUrl } from './network.js';
import { directoryKey } from './identity.js';

const uuid = /^[a-f0-9-]{36}$/;
export const urlKey = (value) => {
  const url = localUrl(value);
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.href;
};
const routeKey = (value) => {
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
};

const displacedBy = (project, endpoint, owner, current) => {
  const canonical = urlKey(endpoint.url);
  const incoming = urlKey(current.url);
  if (canonical === incoming) return true;
  if (new URL(canonical).origin !== new URL(incoming).origin) return false;
  // Different routes may share a listener; only changed ownership invalidates them.
  if (endpoint.observation && current.observation)
    return endpoint.observation !== current.observation;
  return !!(
    project.identity &&
    owner.identity &&
    project.identity.key !== owner.identity.key
  );
};

export function validateLibrary(saved) {
  if (
    !saved ||
    ![1, 2].includes(saved.version) ||
    typeof saved.screenshotsEnabled !== 'boolean' ||
    !Array.isArray(saved.projects) ||
    saved.projects.length > 2000
  )
    throw new Error('资料库格式不受支持');
  if (saved.autoRefresh !== undefined && typeof saved.autoRefresh !== 'boolean')
    throw new Error('自动刷新设置无效');
  const ids = new Set();
  for (const item of saved.projects) {
    if (
      !uuid.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 100 ||
      typeof item.favorite !== 'boolean'
    )
      throw new Error('项目元数据无效');
    ids.add(item.id);
    localUrl(item.url);
    for (const field of ['addedAt', 'lastSeen', 'lastOpened'])
      if (
        item[field] != null &&
        (typeof item[field] !== 'string' ||
          !Number.isFinite(Date.parse(item[field])))
      )
        throw new Error('项目时间无效');
    for (const field of ['captureAllowed', 'hidden', 'renamed'])
      if (item[field] !== undefined && typeof item[field] !== 'boolean')
        throw new Error('项目设置无效');
    if (
      item.screenshot !== null &&
      item.screenshot !== undefined &&
      !Number.isFinite(Date.parse(item.screenshot))
    )
      throw new Error('截图元数据无效');
    if (
      item.identity != null &&
      (typeof item.identity.directory !== 'string' ||
        !path.isAbsolute(item.identity.directory) ||
        item.identity.directory.length > 4096 ||
        item.identity.key !== directoryKey(item.identity.directory) ||
        !['auto', 'manual'].includes(item.identity.source))
    )
      throw new Error('目录关联无效');
    if (
      item.identity?.branch != null &&
      (typeof item.identity.branch !== 'string' ||
        item.identity.branch.length > 1024)
    )
      throw new Error('Git 分支信息无效');
    if (item.endpoints !== undefined) {
      if (!Array.isArray(item.endpoints) || item.endpoints.length > 64)
        throw new Error('项目地址过多');
      for (const endpoint of item.endpoints) {
        localUrl(endpoint.url);
        if (
          endpoint.observation != null &&
          (typeof endpoint.observation !== 'string' ||
            endpoint.observation.length > 256)
        )
          throw new Error('进程证据无效');
      }
    }
  }
  return saved;
}

export class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'library.json');
    this.screenshots = path.join(directory, 'screenshots');
    this.state = {
      version: 2,
      screenshotsEnabled: false,
      autoRefresh: true,
      projects: [],
      lastScan: null,
    };
    this.pending = Promise.resolve();
    this.session = randomUUID();
  }

  async init() {
    await mkdir(this.screenshots, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    await chmod(this.screenshots, 0o700);
    try {
      const original = await readFile(this.file, 'utf8');
      const saved = validateLibrary(JSON.parse(original));
      if (saved.version === 1) {
        try {
          await writeFile(
            path.join(this.directory, 'library.v1.backup.json'),
            original,
            { flag: 'wx', mode: 0o600 },
          );
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      }
      this.state = { ...this.state, ...saved, version: 2 };
      if (saved.version === 1) this.state.migratedFromV1 = true;
      for (const project of this.state.projects) {
        project.endpoints ||= [
          {
            url: project.url,
            online: false,
            observation: null,
            lastSeen: project.lastSeen,
          },
        ];
        project.identity ||= null;
        project.captureAllowed ??= true;
        project.hidden ??= false;
        project.online = false;
        for (const endpoint of project.endpoints) {
          endpoint.online = false;
          if (
            project.addressReused &&
            urlKey(endpoint.url) === urlKey(project.url)
          )
            endpoint.addressReused = true;
        }
      }
      await this.save();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await this.garbageCollect();
  }

  transaction(task) {
    const operation = this.pending.then(async () => {
      const previous = structuredClone(this.state);
      try {
        const result = await task();
        this.refreshAddressReuse();
        await this.save();
        return result;
      } catch (error) {
        this.state = previous;
        throw error;
      }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  async save() {
    validateLibrary(this.state);
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.file);
  }

  upsert(result, manual = false, scanResults = null) {
    const canonical = urlKey(result.url);
    const identity = result.identity || null;
    const observation = result.observation || null;
    const route = routeKey(result.url);
    const endpointMatch = (item) =>
      item.endpoints?.find((endpoint) => urlKey(endpoint.url) === canonical);
    if (!identity && !observation) {
      const uncertain = this.state.projects.filter((item) => {
        const endpoint = endpointMatch(item);
        return (
          endpoint &&
          !endpoint.addressReused &&
          (endpoint.observation || item.identity)
        );
      });
      if (uncertain.length) {
        // An unverified response is not evidence of a new project or a new owner.
        for (const item of uncertain) {
          Object.assign(endpointMatch(item), {
            online: false,
            status: 'unknown',
            reason: '网页已响应，但暂时无法确认原项目身份，请重新发现',
          });
          const safe = item.endpoints.find(
            (entry) => entry.online && !entry.addressReused,
          );
          item.online = !!safe;
          item.status = safe ? 'online' : 'unknown';
          item.diagnostic = safe
            ? null
            : '网页已响应，但暂时无法确认原项目身份，请重新发现';
          if (safe) item.url = safe.url;
        }
        return uncertain[0];
      }
    }
    const related = this.state.projects.filter(
      (item) =>
        identity &&
        item.identity?.key === identity.key &&
        routeKey(item.url) === route,
    );
    const candidates = related.filter(
      (item) =>
        !item.online ||
        endpointMatch(item) ||
        (observation &&
          item.endpoints.some(
            (endpoint) =>
              endpoint.online &&
              endpoint.observation === observation &&
              new URL(endpoint.url).port === new URL(result.url).port,
          )),
    );
    const canMove = (item) => {
      if (endpointMatch(item)) return true;
      if (!scanResults) return !item.online;
      const port = (url) => {
        const parsed = new URL(url);
        return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
      };
      return !scanResults.some(
        (found) =>
          observation &&
          found.observation === observation &&
          routeKey(found.url) === route &&
          port(found.url) !== port(result.url),
      );
    };
    const observed = candidates.filter(
      (item) =>
        observation &&
        item.endpoints.some((endpoint) => endpoint.observation === observation),
    );
    const directoryRoles = scanResults
      ? new Set(
          scanResults
            .filter(
              (found) =>
                routeKey(found.url) === route &&
                (found.identity?.key === identity?.key ||
                  (found.observation &&
                    related.some((item) =>
                      item.endpoints.some(
                        (endpoint) =>
                          endpoint.observation === found.observation,
                      ),
                    )) ||
                  (!found.identity &&
                    related.some((item) =>
                      item.endpoints.some(
                        (endpoint) =>
                          urlKey(endpoint.url) === urlKey(found.url),
                      ),
                    ))),
            )
            .map((found) => {
              const url = new URL(found.url);
              return url.port || (url.protocol === 'https:' ? '443' : '80');
            }),
        ).size
      : null;
    // A shared directory or recycled port cannot identify concurrent service roles.
    let project =
      observed.length === 1 && canMove(observed[0])
        ? observed[0]
        : observed.length > 1
          ? observed.find(endpointMatch)
          : null;
    if (
      !project &&
      related.length === 1 &&
      candidates.length === 1 &&
      (directoryRoles === null
        ? !candidates[0].online ||
          candidates[0].endpoints.every(
            (endpoint) =>
              !endpoint.online || endpoint.observation === observation,
          )
        : directoryRoles === 1) &&
      canMove(candidates[0])
    )
      project = candidates[0];
    if (!project)
      project = this.state.projects.find((item) => {
        const endpoint = endpointMatch(item);
        if (!endpoint) return false;
        if (identity && item.identity?.key === identity.key) return false;
        if (
          identity &&
          item.identity &&
          item.identity?.key !== identity.key &&
          item.identity?.source !== 'manual'
        )
          return false;
        if (observation) return endpoint.observation === observation;
        if (endpoint.addressReused) return false;
        return (
          !identity &&
          !item.identity &&
          item.seenSession === this.session &&
          item.lastTitle === result.title
        );
      });
    if (!project) {
      project = {
        id: randomUUID(),
        url: result.url,
        name: result.title.slice(0, 100),
        favorite: false,
        screenshot: null,
        lastOpened: null,
        addedAt: new Date().toISOString(),
        identity,
        endpoints: [],
        captureAllowed: true,
        hidden: false,
      };
      this.state.projects.push(project);
    }
    if (identity && project.identity?.source !== 'manual')
      project.identity = identity;
    project.lastTitle = result.title;
    project.seenSession = this.session;
    project.lastSeen = new Date().toISOString();
    let endpoint = endpointMatch(project);
    if (!endpoint) {
      endpoint = { url: result.url };
      project.endpoints.push(endpoint);
      if (project.endpoints.length > 64) project.endpoints.shift();
    }
    Object.assign(endpoint, {
      online: true,
      addressReused: false,
      status: 'online',
      reason: null,
      observation,
      lastSeen: project.lastSeen,
    });
    project.url = result.url;
    project.online = true;
    project.status = 'online';
    project.diagnostic = null;
    if (manual) project.manual = true;
    for (const other of this.state.projects) {
      if (other.id === project.id) continue;
      let displaced = false;
      for (const previous of other.endpoints) {
        if (!displacedBy(other, previous, project, endpoint)) continue;
        Object.assign(previous, {
          online: false,
          addressReused: true,
          status: 'offline',
          reason: '地址已被其他项目复用',
        });
        displaced = true;
      }
      if (!displaced) continue;
      const available = other.endpoints.filter(
        (item) => item.online && !item.addressReused,
      );
      const safe =
        available.find((item) => urlKey(item.url) === urlKey(other.url)) ||
        available[0];
      other.online = !!safe;
      if (safe) {
        other.url = safe.url;
        other.status = 'online';
        other.diagnostic = null;
      } else {
        other.status = 'offline';
        other.diagnostic = '旧地址已被其他项目复用，请等待原项目重新发现';
      }
    }
    this.refreshAddressReuse();
    return project;
  }

  refreshAddressReuse() {
    for (const project of this.state.projects) {
      const primary = project.endpoints.find(
        (endpoint) => urlKey(endpoint.url) === urlKey(project.url),
      );
      // Keep the safety marker until this project positively reclaims the address.
      project.addressReused = primary?.addressReused === true;
    }
  }

  async deleteScreenshot(project) {
    await rm(path.join(this.screenshots, `${project.id}.png`), { force: true });
    project.screenshot = null;
  }

  async garbageCollect() {
    const retained = new Set(
      this.state.projects
        .filter(
          (item) =>
            item.screenshot &&
            this.state.screenshotsEnabled &&
            item.captureAllowed !== false,
        )
        .map((item) => `${item.id}.png`),
    );
    for (const file of await readdir(this.screenshots)) {
      if (!retained.has(file) && /^[a-f0-9-]{36}\.png(?:\.tmp)?$/.test(file))
        await rm(path.join(this.screenshots, file), { force: true });
    }
  }

  async storageUsage() {
    let bytes = 0;
    let count = 0;
    for (const item of this.state.projects) {
      if (!item.screenshot) continue;
      try {
        const info = await stat(path.join(this.screenshots, `${item.id}.png`));
        bytes += info.size;
        count++;
      } catch {
        /* Missing files remain removable. */
      }
    }
    return { bytes, count };
  }

  async metadataCheckpoint() {
    const backup = structuredClone(this.state);
    for (const item of backup.projects) item.screenshot = null;
    // Recovery metadata intentionally excludes images; privacy deletion never keeps a hidden image copy.
    await writeFile(
      path.join(this.directory, 'before-restore.json'),
      JSON.stringify(backup, null, 2),
      { mode: 0o600 },
    );
  }
}
