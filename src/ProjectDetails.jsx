import React, { useEffect, useState } from 'react';
import { projectSummary, useConfirmation } from './Confirmation.jsx';

export default function ProjectDetails({ project, disabled, action, close }) {
  const ask = useConfirmation();
  const [directory, setDirectory] = useState(project.identity?.directory || '');
  const [editor, setEditor] = useState('finder');
  const [fieldError, setFieldError] = useState('');
  useEffect(
    () => setDirectory(project.identity?.directory || ''),
    [project.id, project.identity?.directory],
  );
  const base = `projects/${project.id}`;
  return (
    <>
      <div className="dialog-header">
        <span className="mini-label">A PLACE TO COME BACK TO</span>
        <button
          className="icon-button"
          aria-label="关闭项目详情"
          onClick={close}
        >
          ×
        </button>
      </div>
      <h2 id="details-title">{project.name}</h2>
      <p>
        目录是身份线索之一，同目录也可能有多个服务。关联或解除不同目录会删除旧封面，避免误归属；同名历史记录请在「同名待核对」中比较。
      </p>
      <form
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setFieldError('');
          if (!directory.trim() || !directory.trim().startsWith('/')) {
            setFieldError('请输入应用目录的绝对路径。');
            return;
          }
          if (
            project.screenshot &&
            directory.trim() !== project.identity?.directory
          ) {
            const decision = await ask({
              title: '更改目录关联？',
              description:
                '若关联到不同目录，现有封面将被删除，避免把旧页面归到新项目。',
              items: [projectSummary(project)],
              note: `新的目录：${directory.trim()}。收藏与项目记录保留，不会启动或停止项目。`,
              confirmLabel: '确认保存目录关联',
              destructive: true,
            });
            if (!decision.confirmed) return;
          }
          action('bind', `${base}/binding`, 'POST', {
            directory: directory.trim(),
          });
        }}
      >
        <label className="field-label" htmlFor="directory">
          应用目录（绝对路径）
        </label>
        <input
          className="text-field"
          id="directory"
          required
          aria-invalid={!!fieldError}
          aria-describedby={fieldError ? 'directory-error' : undefined}
          value={directory}
          onChange={(event) => {
            setDirectory(event.target.value);
            setFieldError('');
          }}
          placeholder="/Users/you/Projects/my-app"
          autoComplete="off"
        />
        {fieldError && (
          <p id="directory-error" role="alert" className="notice error">
            {fieldError}
          </p>
        )}
        <small>
          选择应用自身目录；monorepo 的不同应用、不同 worktree
          不应绑定为同一目录。
        </small>
        <div className="binding-state">
          <span>
            {project.identity
              ? project.identity.source === 'manual'
                ? '手动关联'
                : '自动识别'
              : '尚未关联'}
          </span>
          <span>
            {project.identity?.available === false
              ? '目录不存在或无权读取'
              : project.identity?.branch
                ? `Git · ${project.identity.branch}`
                : '未检测到 Git 分支'}
          </span>
        </div>
        <div className="dialog-actions compact">
          <button
            type="button"
            className="button quiet"
            disabled={disabled || !project.identity}
            onClick={async () => {
              const decision = await ask({
                title: '解除目录关联？',
                description:
                  '将清除这张卡片的目录身份，并删除当前封面。项目记录和收藏保留。',
                items: [projectSummary(project)],
                note: '后续发现可能重新识别目录；本次不会停止服务。删除的封面无法撤销，可在允许截图后重新生成。',
                confirmLabel: '解除关联',
                destructive: true,
              });
              if (decision.confirmed)
                action('unbind', `${base}/binding`, 'DELETE');
            }}
          >
            解除关联
          </button>
          <button className="button primary" disabled={disabled}>
            保存目录关联
          </button>
        </div>
      </form>
      <div className="directory-actions">
        <label className="field-label" htmlFor="editor">
          回到开发现场
        </label>
        <div>
          <select
            id="editor"
            value={editor}
            onChange={(event) => setEditor(event.target.value)}
          >
            <option value="finder">Finder</option>
            <option value="vscode">VS Code</option>
            <option value="cursor">Cursor</option>
          </select>
          <button
            className="button outline"
            disabled={
              disabled ||
              !project.identity ||
              project.identity.available === false
            }
            onClick={() =>
              action('open-directory', `${base}/open-directory`, 'POST', {
                editor,
              })
            }
          >
            打开所选应用 ↗
          </button>
        </div>
      </div>
      <label className="setting-toggle">
        <div>
          <strong>此项目允许截图</strong>
          <span>关闭立即删除本项目封面；全局许可仍需单独开启。</span>
        </div>
        <input
          type="checkbox"
          aria-label="此项目允许截图"
          checked={project.captureAllowed !== false}
          disabled={disabled}
          onChange={async (event) => {
            const enabled = event.target.checked;
            if (!enabled) {
              const decision = await ask({
                title: '禁止此项目截图？',
                description:
                  '关闭后会删除这张卡片的现有封面；项目名称、收藏与目录关联保留。',
                items: [projectSummary(project)],
                note: '全局截图许可不会因此改变。已导出的备份不受此开关控制。',
                confirmLabel: '禁止截图并删除封面',
                destructive: true,
              });
              if (!decision.confirmed) return;
            }
            action('capture-permission', base, 'PATCH', {
              captureAllowed: enabled,
            });
          }}
        />
      </label>
      <div className="endpoint-list">
        <strong>地址记录</strong>
        {project.endpoints?.map((endpoint) => (
          <div key={endpoint.url}>
            <span className={`status-dot ${endpoint.online ? '' : 'dim'}`} />
            <code>{endpoint.url}</code>
            <small>{endpoint.online ? '最近探测在线' : '历史地址'}</small>
          </div>
        ))}
      </div>
      {project.diagnostic && (
        <p className="small-print">{project.diagnostic}</p>
      )}
      <div className="dialog-actions">
        <button
          className="button quiet"
          disabled={disabled}
          onClick={async () => {
            if (!project.hidden) {
              const decision = await ask({
                title: '忽略这个项目？',
                description:
                  '只隐藏这张记录，封面、收藏和目录关联保留，不会停止服务。',
                items: [projectSummary(project)],
                note: '可从侧栏「已忽略」随时恢复。忽略不是标题或端口黑名单。',
                confirmLabel: '移至已忽略',
              });
              if (!decision.confirmed) return;
            }
            if (
              await action('hide', base, 'PATCH', { hidden: !project.hidden })
            )
              close();
          }}
        >
          {project.hidden ? '恢复到项目库' : '忽略此项目'}
        </button>
        <button className="button primary" onClick={close}>
          完成
        </button>
      </div>
    </>
  );
}
