import React, { useEffect, useState } from 'react';
import { useI18n } from './I18n.jsx';

const installCommand = 'npm exec --no -- playwright install chromium';

export default function GettingStarted({ onPrivacy, onClose }) {
  const { t, locale } = useI18n();
  const [browser, setBrowser] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setBrowser(null);
    fetch('/api/capabilities', {
      signal: controller.signal,
      headers: { 'X-Locade-Language': locale },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('capability unavailable');
        const value = await response.json();
        if (
          !['available', 'missing', 'unknown'].includes(
            value.screenshots?.state,
          )
        )
          throw new Error('invalid capability');
        if (!controller.signal.aborted) setBrowser(value.screenshots.state);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBrowser('unknown');
      });
    return () => controller.abort();
  }, [attempt, locale]);

  return (
    <section
      className="getting-started"
      aria-labelledby="getting-started-title"
    >
      <div className="guide-heading">
        <div>
          <span className="mini-label">A FIRST ROUND / LOCADE</span>
          <h2 id="getting-started-title">{t('先认识你的本地游乐场。')}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('收起使用指南')}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <ol className="guide-steps">
        <li>
          <strong>{t('自行启动项目，再发现')}</strong>
          <p>
            {t(
              '在你熟悉的终端或 IDE 启动网页项目。Locade 不运行项目命令，也不停止外部服务。',
            )}
          </p>
        </li>
        <li>
          <strong>{t('选择截图，或先只收藏')}</strong>
          <p>
            {t(
              '默认不截图。可先发现、收藏与打开；需要封面时，到隐私设置明确允许，再逐卡生成。',
            )}
          </p>
        </li>
        <li>
          <strong>{t('以后按画面找回来')}</strong>
          <p>
            {t(
              '关闭项目后卡片与封面仍保留。截图不上传，但可能含秘密；你可以随时禁用或删除。',
            )}
          </p>
        </li>
      </ol>
      <div className="browser-readiness" role="status">
        <strong>{t('截图浏览器')}</strong>
        <p>
          {t(
            browser === 'available'
              ? '已找到浏览器文件，实际启动仍可能受系统策略限制。'
              : browser === 'missing'
                ? '尚未安装匹配浏览器；不影响发现、收藏和打开项目。'
                : browser === 'unknown'
                  ? '无法确认浏览器状态，请重试。'
                  : '正在检查截图依赖…',
          )}
        </p>
        {browser !== 'available' && (
          <>
            <code className="install-command">{installCommand}</code>
            <p className="small-print">
              {t(
                '在 Locade 源码目录的终端手动执行；不会由网页安装。npm 镜像不改变浏览器下载来源。',
              )}
            </p>
            <button
              type="button"
              className="button quiet"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(installCommand);
                  setMessage('命令已复制；请自行检查并在终端执行。');
                } catch {
                  setMessage('无法访问剪贴板，请手动选择并复制命令。');
                }
              }}
            >
              {t('复制安装命令')}
            </button>
          </>
        )}
        <button
          type="button"
          className="button quiet"
          disabled={!browser}
          onClick={() => setAttempt((value) => value + 1)}
        >
          {t('重新检查')}
        </button>
        {message && (
          <p role="status" className="small-print">
            {t(message)}
          </p>
        )}
      </div>
      <button type="button" className="button outline" onClick={onPrivacy}>
        {t('查看隐私与截图设置')}
      </button>
    </section>
  );
}
