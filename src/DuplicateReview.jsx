import { useI18n, formatLocalDate } from './I18n.jsx';
import React, { useEffect, useState } from 'react';
import { projectSummary, useConfirmation } from './Confirmation.jsx';
import { translateDiagnostic } from '../server/i18n.js';

export default function DuplicateReview({
  projects,
  groupName,
  session,
  setGroupName,
  imagesAllowed,
  disabled,
  request,
  close,
}) {
  const { t, locale } = useI18n();
  const formatDate = (value) =>
    formatLocalDate(value, locale, t('尚无记录'), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  const ask = useConfirmation();
  const [selection, setSelection] = useState({ ids: [] });
  const selected =
    selection.groupName === groupName && selection.session === session
      ? selection.ids
      : [];
  const setSelected = (update) =>
    setSelection((previous) => {
      const current =
        previous.groupName === groupName && previous.session === session
          ? previous.ids
          : [];
      return {
        groupName,
        session,
        ids: typeof update === 'function' ? update(current) : update,
      };
    });
  const [undo, setUndo] = useState(null);
  const [undoExpired, setUndoExpired] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => {
    setError('');
    setMessage('');
  }, [groupName, session]);

  const groups = new Map();
  for (const project of projects) {
    const name = project.name.trim();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(project);
  }
  const groupOptions = [...groups].filter(
    ([name, items]) => items.length > 1 || name === groupName,
  );
  const group = groups.get(groupName) || [];
  const choices = group.filter(
    (project) => selected.includes(project.id) && !project.hidden,
  );

  async function archive() {
    if (!choices.length || disabled) return;
    if (choices.length > 100) {
      setError(t('每次最多整理 100 项，请减少选择。'));
      return;
    }
    const decision = await ask({
      title: t('将 {0} 项移至已忽略？', [choices.length]),
      description: t(
        '只隐藏下列记录，不合并身份，不转移名称、收藏或封面，也不会停止服务。',
      ),
      items: choices.map((project) => projectSummary(project, t)),
      note: t(
        '图片仍保留并占用本机空间。完成后可撤销本次整理，也可从「已忽略」逐项恢复。',
      ),
      confirmLabel: t('移至已忽略（{0}）', [choices.length]),
    });
    if (!decision.confirmed) return;
    setError('');
    setMessage('');
    try {
      const result = await request('projects/visibility', 'POST', {
        updates: choices.map((project) => ({
          id: project.id,
          hidden: true,
          expected: project.reviewKey,
        })),
      });
      const changes = choices.map((project) => {
        const current = result.projects.find((item) => item.id === project.id);
        if (!current?.reviewKey)
          throw new Error(
            t(
              '操作已返回，但缺少撤销凭据；请重新载入核对，并在「已忽略」中检查记录。',
            ),
          );
        return { id: project.id, hidden: false, expected: current.reviewKey };
      });
      setUndo(changes);
      setUndoExpired(false);
      setSelected([]);
      setMessage(
        t('已将 {0} 项移至「已忽略」，未转移或删除资料与图片。', [
          choices.length,
        ]),
      );
    } catch (failure) {
      setError(failure.message || t('整理未完成，请重新载入核对。'));
    }
  }

  async function undoArchive() {
    if (!undo || disabled || undoExpired) return;
    setError('');
    setMessage('');
    try {
      await request('projects/visibility', 'POST', { updates: undo });
      setMessage(t('已撤销本次整理，恢复 {0} 项。', [undo.length]));
      setUndo(null);
      setSelected([]);
    } catch (failure) {
      setUndoExpired(true);
      setError(
        t('{0} 本次撤销不会覆盖新改动；可重新载入并在「已忽略」逐项核对。', [
          failure.message || t('记录已变化，无法安全撤销。'),
        ]),
      );
    }
  }

  async function reload() {
    setError('');
    try {
      await request('library');
      setSelected([]);
      setMessage(t('已重新载入；请选择需要忽略的记录，再明确确认。'));
    } catch (failure) {
      setError(failure.message || t('无法重新载入本机资料库。'));
    }
  }

  return (
    <>
      <div className="dialog-header">
        <span className="mini-label">SAME NAME, NOT ALWAYS THE SAME WORK</span>
        <button
          className="icon-button"
          aria-label={t('关闭同名核对')}
          onClick={close}
        >
          ×
        </button>
      </div>
      <h2 id="duplicate-title">{t('同名项目，逐项核对。')}</h2>
      <p className="duplicate-intro">
        {t(
          '同名不等于同一作品，同目录也可能运行不同服务。这里只帮助比较，不自动合并、修改身份或停止项目。',
        )}
      </p>
      <label className="field-label" htmlFor="duplicate-group">
        {t('核对哪组同名记录')}
      </label>
      <select
        id="duplicate-group"
        value={groupName}
        disabled={disabled}
        onChange={(event) => setGroupName(event.target.value)}
      >
        {groupOptions.map(([name, items]) => (
          <option key={name} value={name}>
            {name} · {items.filter((item) => !item.hidden).length}
            {t(' 项在库 /')} {items.length}
            {t(' 项记录')}
          </option>
        ))}
      </select>
      <p className="small-print duplicate-warning">
        {t(
          '默认不选中任何项目。只把你确认不需要展示的记录移至「已忽略」；图片仍留在本机并占用空间，不会转移到其他卡片。',
        )}
      </p>
      <div className="duplicate-list">
        {group.map((project) => (
          <article
            key={project.id}
            className={`duplicate-item ${project.hidden ? 'is-ignored' : ''}`}
            data-review-id={project.id}
          >
            {imagesAllowed &&
              project.captureAllowed !== false &&
              project.screenshot && (
                <img
                  className="duplicate-cover"
                  src={`/screenshots/${project.id}.png?v=${encodeURIComponent(project.screenshot)}`}
                  alt={t('{0} {1} 的已保存封面', [
                    project.name,
                    project.id.slice(0, 8),
                  ])}
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                />
              )}
            <label className="duplicate-choice">
              <input
                type="checkbox"
                aria-label={t('选择移至已忽略 {0}', [project.id.slice(0, 8)])}
                checked={selected.includes(project.id) && !project.hidden}
                disabled={disabled || project.hidden || !project.reviewKey}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, project.id]
                      : current.filter((id) => id !== project.id),
                  )
                }
              />
              <span>
                <strong>{project.name}</strong>
                <code>{project.id.slice(0, 8)}</code>
              </span>
              <small>
                {project.hidden
                  ? t('已忽略 · 可恢复')
                  : project.addressReused
                    ? t('旧地址已复用')
                    : project.online
                      ? t('最近探测在线')
                      : t('未确认在线')}
              </small>
            </label>
            <dl className="duplicate-facts">
              <div>
                <dt>{t('完整目录')}</dt>
                <dd>{project.identity?.directory || t('尚未关联目录')}</dd>
              </div>
              <div>
                <dt>{t('识别依据')}</dt>
                <dd>
                  {project.identity
                    ? `${project.identity.source === 'manual' ? t('手动关联') : t('自动识别')}${project.identity.available === false ? t(' · 目录不可用') : ''}${project.identity.branch ? ` · ${project.identity.branch}` : ''}`
                    : t('缺少目录身份，不能只凭标题或端口认定同一项目')}
                </dd>
              </div>
              <div>
                <dt>{t('当前地址')}</dt>
                <dd>
                  <code>{project.url}</code>
                </dd>
              </div>
              <div>
                <dt>{t('收藏 / 封面')}</dt>
                <dd>
                  {project.favorite ? t('已收藏') : t('未收藏')} ·{' '}
                  {project.screenshot
                    ? t('有本地封面（{0}）', [formatDate(project.screenshot)])
                    : t('无封面')}
                </dd>
              </div>
              <div>
                <dt>{t('添加时间')}</dt>
                <dd>{formatDate(project.addedAt)}</dd>
              </div>
              <div>
                <dt>{t('最后发现')}</dt>
                <dd>{formatDate(project.lastSeen)}</dd>
              </div>
            </dl>
            <div className="duplicate-endpoints">
              <strong>{t('全部地址记录')}</strong>
              {(project.endpoints?.length
                ? project.endpoints
                : [{ url: project.url }]
              ).map((endpoint) => (
                <div key={endpoint.url}>
                  <code>{endpoint.url}</code>
                  <small>
                    {endpoint.addressReused
                      ? t('地址已复用 · 禁止误开')
                      : endpoint.online
                        ? t('最近探测在线')
                        : t('历史地址 / 未确认在线')}
                    {endpoint.reason
                      ? ` · ${translateDiagnostic(endpoint.reason, locale)}`
                      : ''}
                  </small>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="notice error duplicate-message">
          {t(error)}
        </p>
      )}
      {message && (
        <p role="status" className="notice duplicate-message">
          {t(message)}
        </p>
      )}
      {undo && (
        <div className="duplicate-undo">
          <span>
            {undoExpired
              ? t('本次撤销凭据已失效，不覆盖后续修改。')
              : t('仅撤销最近这次整理（{0} 项），不会恢复更早的操作。', [
                  undo.length,
                ])}
          </span>
          <button
            className="button outline"
            disabled={disabled || undoExpired}
            onClick={undoArchive}
          >
            {t('撤销本次操作')}
          </button>
        </div>
      )}
      <div className="dialog-actions duplicate-actions">
        <button className="button quiet" disabled={disabled} onClick={reload}>
          {t('重新载入核对')}
        </button>
        <button className="button outline" onClick={close}>
          {t('完成')}
        </button>
        <button
          className="button primary"
          disabled={disabled || !choices.length}
          onClick={archive}
        >
          {t('移至已忽略（{0}）', [choices.length])}
        </button>
      </div>
      <p className="small-print">
        {t(
          '已忽略的记录可从侧栏恢复。忽略仅针对这些卡片，不是按标题或端口拉黑；身份不足时后续发现仍可能新增记录。',
        )}
      </p>
    </>
  );
}
