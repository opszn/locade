import { createHash } from 'node:crypto';

export function projectReviewKey(project) {
  const { lastSeen, seenSession, reviewKey, ...details } = project;
  const endpoints = project.endpoints?.map(
    ({ lastSeen, ...endpoint }) => endpoint,
  );
  return createHash('sha256')
    .update(JSON.stringify({ ...details, endpoints }))
    .digest('hex');
}

export function updateVisibility(store, updates) {
  if (!Array.isArray(updates) || !updates.length || updates.length > 100)
    throw new Error('每次请选择 1–100 项记录核对');
  const ids = new Set();
  const changes = updates.map((update) => {
    if (
      !update ||
      typeof update.hidden !== 'boolean' ||
      typeof update.id !== 'string' ||
      ids.has(update.id)
    )
      throw new Error('整理记录无效或重复');
    ids.add(update.id);
    const project = store.state.projects.find((item) => item.id === update.id);
    if (!project || update.expected !== projectReviewKey(project))
      throw new Error('记录已变化，请重新载入核对后再确认；本次未修改任何记录');
    return { project, hidden: update.hidden };
  });
  for (const { project, hidden } of changes) project.hidden = hidden;
}
