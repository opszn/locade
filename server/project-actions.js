import { localUrl } from './network.js';
import { urlKey } from './store.js';

export function validateProjectPatch(input) {
  for (const field of ['hidden', 'captureAllowed', 'favorite']) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean')
      throw new Error('设置无效');
  }
  if (
    input.name !== undefined &&
    (typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 100)
  )
    throw new Error('名称需要 1–100 个字符');
}

export function assertProjectAddress(project) {
  const endpoint = project.endpoints.find(
    (item) => urlKey(item.url) === urlKey(project.url),
  );
  if (project.addressReused || endpoint?.addressReused)
    throw new Error('旧地址已被其他项目复用，请重新发现原项目后操作');
  return endpoint;
}

export function verifyProjectPage(project, current, port) {
  const endpoint = assertProjectAddress(project);
  const target = localUrl(project.url, port);
  if (!current) throw new Error('网页当前不可用，请重新发现');
  if (urlKey(current.url) !== urlKey(target.href))
    throw new Error('页面地址已变化，请重新发现');
  if (
    (endpoint?.observation && current.observation !== endpoint.observation) ||
    (current.identity &&
      project.identity &&
      current.identity.key !== project.identity.key &&
      !(
        project.identity.source === 'manual' &&
        endpoint?.observation &&
        endpoint.observation === current.observation
      ))
  )
    throw new Error('端口所属项目已变化或暂时无法确认，请重新发现后操作');
  if (
    project.lastTitle &&
    current.title !== project.lastTitle &&
    !(
      current.identity &&
      project.identity &&
      current.identity.key === project.identity.key
    )
  )
    throw new Error('页面身份可能已变化，请重新发现后操作');
  return target.href;
}
