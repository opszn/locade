import React, { useEffect, useRef, useState } from 'react';
import { useConfirmation } from './Confirmation.jsx';

export default function LibraryTools({
  library,
  disabled,
  action,
  getToken,
  onRestore,
  reportError,
  onWorking,
}) {
  const ask = useConfirmation();
  const [usage, setUsage] = useState(null);
  const [usageError, setUsageError] = useState('');
  const [usageRetry, setUsageRetry] = useState(0);
  const [message, setMessage] = useState('');
  const [includeImages, setIncludeImages] = useState(false);
  const [working, setWorking] = useState(false);
  const fileInput = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    setUsageError('');
    fetch('/api/storage', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取截图用量，请重试。');
        return response.json();
      })
      .then(setUsage)
      .catch((error) => {
        if (!controller.signal.aborted)
          setUsageError(error.message || '无法读取截图用量，请重试。');
      });
    return () => controller.abort();
  }, [library, usageRetry]);
  const locked = working || disabled;
  async function backup() {
    setWorking(true);
    onWorking('backup');
    setMessage('');
    reportError('');
    try {
      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Locade-Token': getToken(),
        },
        body: JSON.stringify({ includeScreenshots: includeImages }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `locade-${new Date().toISOString().slice(0, 10)}.json.gz`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('备份已交给浏览器下载，请在下载记录中确认并妥善保管。');
    } catch (error) {
      reportError(error.message);
    } finally {
      setWorking(false);
      onWorking('');
    }
  }
  async function restore(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setMessage('');
    reportError('');
    if (file.size > 48 * 1024 * 1024) {
      reportError('备份文件超过 48 MB');
      return;
    }
    const decision = await ask({
      title: '从备份替换当前项目库？',
      description: `即将读取本机文件「${file.name}」。恢复会替换当前项目记录，不是追加。仅使用你信任的备份。`,
      note: '恢复前自动保留不含图片的元数据副本。默认仅恢复元数据并关闭截图；勾选后才允许恢复备份中的图片。文件只在本机处理，不上传。',
      checkbox: {
        label: '同时恢复备份中的截图',
        description: '图片可能含敏感内容；不勾选则仅恢复元数据。',
      },
      confirmLabel: '确认替换并恢复',
      destructive: true,
    });
    if (!decision.confirmed) return;
    setWorking(true);
    onWorking('restore');
    reportError('');
    try {
      const response = await fetch('/api/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/gzip',
          'X-Locade-Token': getToken(),
          'X-Locade-Confirm': 'replace-library',
          'X-Locade-Images': decision.checked ? 'include' : 'exclude',
        },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onRestore(result);
      setMessage(
        `项目库已恢复${decision.checked ? '，已允许恢复备份图片' : '；仅恢复元数据，截图保持关闭'}。项目状态将重新探测。`,
      );
    } catch (error) {
      reportError(error.message);
    } finally {
      setWorking(false);
      onWorking('');
    }
  }
  return (
    <section className="library-tools" aria-label="资料库管理">
      <h3>本机资料库</h3>
      <p>
        {usage
          ? `${usage.count} 张截图 · ${(usage.bytes / 1024 / 1024).toFixed(1)} MB`
          : '正在读取本机截图用量…'}
      </p>
      {usageError && (
        <div className="notice error" role="alert">
          {usageError}
          <button
            type="button"
            onClick={() => setUsageRetry((value) => value + 1)}
          >
            重新读取用量
          </button>
        </div>
      )}
      <div className="storage-actions">
        <button
          className="button outline"
          disabled={locked || !usage?.count || !!usageError}
          onClick={async () => {
            const decision = await ask({
              title: '清空全部本机截图？',
              description: `将删除当前资料库的 ${usage.count} 张截图，项目记录、收藏和目录关联保留。`,
              note: '此操作无法撤销，不会关闭截图许可，也不会删除你另行导出的备份。',
              confirmLabel: '删除全部截图',
              destructive: true,
            });
            if (decision.confirmed)
              action('clear-images', 'screenshots', 'DELETE');
          }}
        >
          清空全部截图
        </button>
        <button className="button outline" disabled={locked} onClick={backup}>
          {working ? '正在处理…' : '导出本地备份'}
        </button>
        <button
          className="button quiet"
          disabled={locked}
          onClick={() => fileInput.current.click()}
        >
          从备份恢复
        </button>
      </div>
      <label className="backup-checkbox">
        <input
          type="checkbox"
          checked={includeImages}
          onChange={(event) => setIncludeImages(event.target.checked)}
          disabled={locked}
        />
        导出时包含截图（可能含秘密，请勿随意分享）
      </label>
      <input
        ref={fileInput}
        type="file"
        accept=".gz,.json,application/gzip,application/json"
        hidden
        aria-label="选择 Locade 备份"
        onChange={restore}
      />
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <p className="small-print">
        备份仅下载到本机，不上传。外部备份不受截图删除开关控制。恢复前的元数据副本位于
        before-restore.json；仅含路径、名称和关联，不保留旧图片。
      </p>
      <details className="diagnostics">
        <summary>诊断与权限说明</summary>
        <p>
          版本：{library?.appVersion || '读取中'}
          <br />
          资料目录：<code>{library?.dataDirectory}</code>
          <br />
          发现来源：{library?.scanSource || '尚未扫描'}
          <br />
          最近扫描耗时：
          {library?.scanElapsedMs == null
            ? '未测量'
            : `${library.scanElapsedMs} ms`}
        </p>
        <p>
          进程工作目录通过当前用户可见的 lsof 查询；Git 仅只读元数据，不运行 Git
          hooks，不扫描全盘。打开编辑器只接受 Finder / VS Code /
          Cursor，不执行任意命令。鉴权、自签名证书和重定向可能导致发现失败。
        </p>
      </details>
    </section>
  );
}
