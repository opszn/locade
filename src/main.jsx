import {
  useI18n,
  formatLocalDate,
  I18nProvider,
  LanguagePicker,
} from './I18n.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import ProjectDetails from './ProjectDetails.jsx';
import LibraryTools from './LibraryTools.jsx';
import DuplicateReview from './DuplicateReview.jsx';
import GettingStarted from './GettingStarted.jsx';
import {
  ConfirmationProvider,
  projectSummary,
  useConfirmation,
} from './Confirmation.jsx';

function Icon({ name, size = 20, ...props }) {
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    star: (
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />
    ),
    pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: (
      <>
        <path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5" />
      </>
    ),
    arrow: <path d="M5 19 19 5M5 5h14v14" />,
    camera: (
      <>
        <path d="M8 5 6 8H3v12h18V8h-3l-2-3Z" />
        <circle cx="12" cy="13" r="3" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="16" cy="17" r="3" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

function App() {
  const { t, locale } = useI18n();
  const date = (value) => formatLocalDate(value, locale, t('尚未扫描'));
  const ask = useConfirmation();
  const [library, setLibrary] = useState(null);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openPanel, setOpenPanel] = useState(null);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [address, setAddress] = useState('http://localhost:');
  const [pendingScreenshots, setPendingScreenshots] = useState(null);
  const [pendingAutoRefresh, setPendingAutoRefresh] = useState(null);
  const addDialog = useRef(null);
  const settingsDialog = useRef(null);
  const searchInput = useRef(null);
  const token = useRef('');
  const [selectedId, setSelectedId] = useState(null);
  const detailsDialog = useRef(null);
  const reviewDialog = useRef(null);
  const [reviewName, setReviewName] = useState('');
  const [reviewSession, setReviewSession] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideHidden, setGuideHidden] = useState(() => {
    try {
      return localStorage.getItem('locade.guide.hidden') === '1';
    } catch {
      return false;
    }
  });
  const selectedProject = library?.projects.find(
    (project) => project.id === selectedId,
  );

  async function request(endpoint, method = 'GET', data) {
    let response, result;
    try {
      response = await fetch(`/api/${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Locade-Token': token.current,
          'X-Locade-Language': locale,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      result = await response.json();
    } catch {
      throw new Error('请求失败，请检查本机服务后重试。');
    }
    if (!response.ok) throw new Error(result.error || t('本机服务暂不可用'));
    token.current = result.token;
    setLibrary(result);
    return result;
  }

  async function action(key, endpoint, method = 'POST', data) {
    setBusy(key);
    if (key !== 'refresh') {
      setError('');
      setNotice('');
    }
    try {
      await request(endpoint, method, data);
      const messages = {
        scan: t('已重新发现本机网页；在线状态以本轮探测为准。'),
        bind: t('目录关联已保存。'),
        unbind: t('目录关联已解除，旧封面已删除。'),
        'capture-permission': data?.captureAllowed
          ? t('此项目已允许截图。')
          : t('此项目已禁止截图，现有封面已删除。'),
        'clear-images': t('本机截图已全部清空，项目记录与关联保留。'),
        hide: data?.hidden
          ? t('项目已移至「已忽略」，可从侧栏恢复。')
          : t('项目已恢复到项目库。'),
        settings: data?.screenshotsEnabled
          ? t('本机截图已允许，仍需逐卡生成封面。')
          : t('本机截图已关闭，全部现有封面已删除。'),
        'auto-refresh': data?.autoRefresh
          ? t('前台自动发现已开启。')
          : t('前台自动发现已关闭，仍可手动重新发现。'),
        'open-directory': t('已向所选应用发送打开请求。'),
      };
      const message =
        messages[key] ||
        (key.startsWith('delete-shot-')
          ? t('本机截图已删除，项目记录保留。')
          : key.startsWith('remove-')
            ? t('项目记录与封面已移除，未停止服务；重新发现时仍可能出现。')
            : key.startsWith('rename-')
              ? t('项目名称已更新。')
              : key.startsWith('capture-')
                ? t('本机截图已更新。')
                : '');
      if (message) setNotice(message);
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    async function init() {
      try {
        await request('library');
        setBusy('scan');
        await request('scan', 'POST', {});
      } catch (failure) {
        setError(failure.message);
      } finally {
        setBusy('');
      }
    }
    init();
    const shortcut = (event) => {
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(
          document.activeElement?.tagName,
        ) &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    if (!library?.autoRefresh) return;
    const timer = setInterval(() => {
      if (
        !busy &&
        document.visibilityState === 'visible' &&
        !document.querySelector('dialog[open], details[open]') &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(
          document.activeElement?.tagName,
        )
      )
        action('refresh', 'scan');
    }, 20000);
    return () => clearInterval(timer);
  }, [library?.autoRefresh, busy, locale]);

  const projects = library?.projects || [];
  const activeProjects = projects.filter((project) => !project.hidden);
  const nameCounts = new Map();
  for (const project of activeProjects) {
    const name = project.name.trim();
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  const sameNames = new Set(
    [...nameCounts].filter(([, count]) => count > 1).map(([name]) => name),
  );
  const sameNameCount = activeProjects.filter((project) =>
    sameNames.has(project.name.trim()),
  ).length;
  const online = activeProjects.filter((project) => project.online).length;
  const favorites = activeProjects.filter((project) => project.favorite).length;
  const visible = projects
    .filter(
      (project) =>
        (tab === 'ignored' ? project.hidden : !project.hidden) &&
        (tab !== 'favorites' || project.favorite) &&
        (tab !== 'online' || project.online) &&
        (tab !== 'unbound' || !project.identity) &&
        (tab !== 'recent' || project.lastOpened) &&
        (tab !== 'duplicates' || sameNames.has(project.name.trim())) &&
        `${project.name} ${project.url} ${(project.endpoints || []).map((endpoint) => endpoint.url).join(' ')} ${project.identity?.directory || ''} ${project.identity?.branch || ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (tab === 'recent'
          ? Date.parse(b.lastOpened || 0) - Date.parse(a.lastOpened || 0)
          : 0) ||
        Number(b.online) - Number(a.online) ||
        Number(b.favorite) - Number(a.favorite) ||
        a.name.localeCompare(b.name),
    );
  const disabled = !!busy;

  function openAdd() {
    setError('');
    setNotice('');
    setOpenPanel('add');
    addDialog.current.showModal();
  }
  function openPrivacy() {
    setError('');
    setNotice('');
    setOpenPanel('settings');
    settingsDialog.current.showModal();
  }
  function closeGuide() {
    setGuideOpen(false);
    setGuideHidden(true);
    try {
      localStorage.setItem('locade.guide.hidden', '1');
    } catch {
      /* Optional local preference. */
    }
  }
  async function reconnect() {
    setBusy('loading');
    setError('');
    try {
      await request('library');
      await request('scan', 'POST', {});
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }
  async function addProject(event) {
    event.preventDefault();
    try {
      const target = new URL(address);
      if (
        !['http:', 'https:'].includes(target.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
        target.username ||
        target.password
      )
        throw new Error(t('请输入不含账号密码的本机 HTTP(S) 地址。'));
    } catch (failure) {
      setError(
        failure.message.startsWith(t('请输入'))
          ? failure.message
          : t('请输入有效的本机 HTTP(S) 地址，例如 http://localhost:3000。'),
      );
      return;
    }
    if (await action('add', 'projects', 'POST', { url: address })) {
      addDialog.current.close();
      setAddress('http://localhost:');
      setTab('all');
      setSearch('');
      setNotice(t('项目已加入本机资料库。'));
    }
  }
  function reviewDuplicates(name) {
    const target =
      name ||
      visible
        .find((project) => sameNames.has(project.name.trim()))
        ?.name.trim() ||
      [...sameNames][0];
    if (!target) return;
    setError('');
    setNotice('');
    setOpenPanel('review');
    setReviewName(target);
    setReviewSession((session) => session + 1);
    reviewDialog.current.showModal();
  }
  async function reviewRequest(...args) {
    setBusy('review');
    try {
      return await request(...args);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label={t('Locade 首页')}>
          <img src="/brand/locade-wordmark.svg" alt="locade" />
          <span>LOCALHOST ARCADE</span>
        </a>
        <div className="nav-heading">
          {t('你的游乐场 ')}
          <span>01</span>
        </div>
        <nav aria-label={t('项目分类')}>
          {[
            ['all', 'grid', t('全部项目'), activeProjects.length],
            ['online', 'pulse', t('正在运行'), online],
            ['favorites', 'star', t('我的收藏'), favorites],
            ['duplicates', 'search', t('同名待核对'), sameNameCount],
            [
              'recent',
              'arrow',
              t('最近打开'),
              activeProjects.filter((item) => item.lastOpened).length,
            ],
            [
              'unbound',
              'plus',
              t('尚未关联'),
              activeProjects.filter((item) => !item.identity).length,
            ],
            [
              'ignored',
              'close',
              t('已忽略'),
              projects.filter((item) => item.hidden).length,
            ],
          ].map(([key, icon, label, count]) => (
            <button
              key={key}
              className={`nav-item ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
            >
              <Icon name={icon} />
              <span>{label}</span>
              <small>{String(count).padStart(2, '0')}</small>
            </button>
          ))}
        </nav>
        <button className="sidebar-add" onClick={openAdd} disabled={disabled}>
          <Icon name="plus" size={18} />
          {t(' 添加本地地址')}
        </button>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="mini-label">NO CLOUD. JUST YOU.</span>
            <p>
              {t('你造的世界，')}
              <br />
              {t('就在这台电脑里。')}
            </p>
            <img src="/brand/locade-icon.svg" alt="" />
          </div>
          <button className="settings-link" onClick={openPrivacy}>
            <Icon name="settings" size={18} />
            {t(' 隐私与截图 ')}
            <span aria-hidden="true">↗</span>
          </button>
          <div className="version">
            <span className="status-dot" /> LOCAL MODE{' '}
            <span>{t('v0.3 本机预览')}</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="topbar-mark">L /</span>
            {t(' 个人项目库')} <span className="topbar-separator">/</span>
            <span className="muted">{t('仅限本机')}</span>
          </div>
          <div className="topbar-tools">
            <button
              type="button"
              className="guide-link"
              onClick={() => setGuideOpen((value) => !value)}
              aria-expanded={
                guideOpen || (!!library && !projects.length && !guideHidden)
              }
            >
              {t('使用指南')}
            </button>
            <LanguagePicker />
            <span className="loopback">
              <span className="status-dot" />
              127.0.0.1
            </span>
          </div>
        </header>
        <section className="hero">
          <div>
            <p className="eyebrow">
              <span /> YOUR LOCAL COLLECTION
            </p>
            <h1>
              {t('本地作品，')}
              <br />
              {t('随时')}
              <span className="headline-accent">{t('开场。')}</span>
            </h1>
            <p className="hero-description">
              {t('散落在端口里的小世界，终于有了自己的位置。')}
              <br className="desktop-break" />
              {t('发现、收藏，然后继续创造。')}
            </p>
          </div>
          <div className="hero-ticket">
            <div className="ticket-top">
              <img src="/brand/locade-icon.svg" alt="" />
              <span>
                ADMIT ONE
                <br />
                <b>LOCALHOST CLUB</b>
              </span>
            </div>
            <div className="ticket-rule" />
            <div className="ticket-bottom">
              <span>
                YOUR LOCALHOST,
                <br />
                READY TO PLAY.
              </span>
              <span className="ticket-number">∞</span>
            </div>
          </div>
        </section>

        {(guideOpen || (!!library && !projects.length && !guideHidden)) && (
          <GettingStarted onPrivacy={openPrivacy} onClose={closeGuide} />
        )}

        <section className="library" aria-labelledby="library-heading">
          <div className="library-toolbar">
            <div className="library-title">
              <h2 id="library-heading">
                {{
                  favorites: t('我的收藏'),
                  online: t('正在运行'),
                  recent: t('最近打开'),
                  unbound: t('尚未关联'),
                  ignored: t('已忽略'),
                  duplicates: t('同名待核对'),
                }[tab] || t('项目陈列室')}
              </h2>
              <span>{String(visible.length).padStart(2, '0')}</span>
            </div>
            <div className="toolbar-actions">
              <button
                className="button quiet"
                disabled={disabled}
                onClick={() => action('scan', 'scan')}
              >
                <Icon
                  name="refresh"
                  size={17}
                  className={busy === 'scan' ? 'spinning' : ''}
                />
                {busy === 'scan' ? t('发现中…') : t('重新发现')}
              </button>
              <button
                className="button primary"
                onClick={openAdd}
                disabled={disabled}
              >
                <Icon name="plus" size={18} />
                {t('添加项目')}
              </button>
            </div>
          </div>
          <div className="filterbar">
            <div className="collection-meta">
              <span className="status-dot" />
              {online}
              {t(' 个运行中')}
              <span className="meta-divider">/</span>
              {favorites}
              {t(' 个收藏')}
            </div>
            <label className="search">
              <Icon name="search" size={17} />
              <input
                ref={searchInput}
                aria-label={t('搜索项目')}
                placeholder={t('搜索名称、目录、分支或历史地址…')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <kbd>/</kbd>
            </label>
          </div>
          {error && !openPanel && (
            <div role="alert" className="notice error">
              {t(error)}
              {!library && (
                <button type="button" disabled={disabled} onClick={reconnect}>
                  {t('重新连接本机资料库')}
                </button>
              )}
              <button
                aria-label={t('关闭错误提示')}
                onClick={() => setError('')}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {notice && !openPanel && (
            <p role="status" className="notice">
              {t(notice)}
            </p>
          )}
          {library?.scanLimited && (
            <p className="notice">
              {t(
                '本轮达到端口或时间限额，部分地址状态尚未确认；可稍后刷新或手动添加。',
              )}
            </p>
          )}
          {library?.migratedFromV1 && (
            <p className="notice">
              {t(
                '旧版资料已保留并备份。旧卡片没有进程身份凭据，不按端口猜测合并。可在「同名待核对」中比较来源，明确选择移至「已忽略」；记录与截图保留，可恢复，不必先删除卡片。',
              )}
            </p>
          )}
          {sameNames.size > 0 && tab !== 'ignored' && (
            <div className="notice same-name-notice">
              <span>
                {t(
                  '发现 {0} 组同名记录。可能是历史卡片，也可能是不同服务；名称相同不代表同一作品。',
                  [sameNames.size],
                )}
              </span>
              <button
                className="button outline"
                disabled={disabled}
                onClick={() => reviewDuplicates()}
              >
                {t('核对同名记录')}
              </button>
            </div>
          )}
          {!library && busy ? (
            <div className="empty">
              <img src="/brand/locade-icon.svg" alt="" />
              <h3>{t('正在打开你的游乐场…')}</h3>
              <p>{t('连接本机资料库。')}</p>
            </div>
          ) : visible.length ? (
            <div className="project-grid">
              {visible.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  disabled={disabled}
                  busy={busy}
                  screenshotsEnabled={library.screenshotsEnabled}
                  action={action}
                  sameNameCount={nameCounts.get(project.name.trim()) || 0}
                  reviewDuplicates={() => reviewDuplicates(project.name.trim())}
                  showDetails={() => {
                    setError('');
                    setNotice('');
                    setOpenPanel('details');
                    setSelectedId(project.id);
                    detailsDialog.current.showModal();
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="empty-art">
                <div className="empty-window">
                  <span />
                  <span />
                  <span />
                  <code>localhost:____</code>
                  <img src="/brand/locade-icon.svg" alt="" />
                </div>
                <span className="empty-orbit">✳</span>
              </div>
              <span className="mini-label">
                {busy === 'scan'
                  ? 'LOOKING AROUND'
                  : 'A LITTLE ROOM FOR POSSIBILITY'}
              </span>
              <h3>
                {busy === 'scan'
                  ? t('正在寻找本机的小世界…')
                  : search
                    ? t('还没有匹配的项目')
                    : tab === 'duplicates'
                      ? t('没有需要核对的同名记录。')
                      : tab === 'favorites'
                        ? t('把喜欢的作品留在这里。')
                        : tab === 'online'
                          ? t('游乐场暂时休息中。')
                          : t('好作品，不该藏在端口里。')}
              </h3>
              <p>
                {search
                  ? t('试试其他名称或端口号。')
                  : tab === 'duplicates'
                    ? t('后续发现同名记录会提示；已忽略的记录可随时恢复。')
                    : tab === 'favorites'
                      ? t('点击项目卡片上的星星，即可加入收藏。')
                      : t(
                          '先自行启动一个网页项目，再重新发现；也可以直接添加本地地址。',
                        )}
              </p>
              {!search && tab !== 'favorites' && tab !== 'duplicates' && (
                <button
                  className="button outline"
                  onClick={openAdd}
                  disabled={disabled}
                >
                  <Icon name="plus" size={17} />
                  {t('添加第一个地址')}
                </button>
              )}
              <small>
                {t('只探测 HTTP(S) 网页 · 不会替你运行任何项目命令')}
              </small>
            </div>
          )}
        </section>
        <footer className="page-footer">
          <span>
            <Icon name="shield" size={14} />
            {t('截图默认关闭，数据只在本机。')}
          </span>
          <span>
            {busy === 'scan'
              ? t('正在探测本机网页…')
              : t('最近发现 {0}', [date(library?.lastScan)])}
            {library?.scanSource ? ` · ${t(library.scanSource)}` : ''}
          </span>
        </footer>
      </main>

      <dialog
        ref={addDialog}
        aria-labelledby="add-title"
        onCancel={() => setError('')}
        onClose={() => setOpenPanel(null)}
      >
        <div className="dialog-header">
          <span className="mini-label">A NEW PLAYER</span>
          <button
            className="icon-button"
            aria-label={t('关闭添加项目')}
            onClick={() => addDialog.current.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="add-title">{t('让一个小世界入场。')}</h2>
        <p>{t('添加正在运行的本地网页。不会执行启动命令。')}</p>
        <form noValidate onSubmit={addProject}>
          <label className="field-label" htmlFor="project-url">
            {t('本地 HTTP(S) 地址')}
          </label>
          <input
            className="text-field"
            id="project-url"
            type="url"
            required
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="http://localhost:3000"
            autoComplete="off"
          />
          <small>
            {t('支持 localhost、127.0.0.1、[::1]，可包含页面路径。')}
          </small>
          {error && (
            <p role="alert" className="notice error">
              {t(error)}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button quiet"
              onClick={() => addDialog.current.close()}
            >
              {t('取消')}
            </button>
            <button className="button primary" disabled={disabled}>
              {busy === 'add' ? t('正在探测…') : t('添加到项目库')}
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={detailsDialog}
        aria-labelledby="details-title"
        onClose={() => setOpenPanel(null)}
      >
        {selectedProject && (
          <ProjectDetails
            key={selectedProject.id}
            project={selectedProject}
            disabled={disabled}
            action={action}
            close={() => detailsDialog.current.close()}
          />
        )}
        {error && (
          <p role="alert" className="notice error">
            {t(error)}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {t(notice)}
          </p>
        )}
      </dialog>

      <dialog
        ref={reviewDialog}
        className="duplicate-dialog"
        aria-labelledby="duplicate-title"
        onClose={() => setOpenPanel(null)}
      >
        <DuplicateReview
          projects={projects}
          groupName={reviewName}
          session={reviewSession}
          setGroupName={setReviewName}
          imagesAllowed={library?.screenshotsEnabled}
          disabled={disabled}
          request={reviewRequest}
          close={() => reviewDialog.current.close()}
        />
      </dialog>

      <dialog
        ref={settingsDialog}
        aria-labelledby="settings-title"
        onClose={() => setOpenPanel(null)}
      >
        <div className="dialog-header">
          <span className="mini-label">LOCAL MEANS LOCAL</span>
          <button
            className="icon-button"
            aria-label={t('关闭隐私设置')}
            onClick={() => settingsDialog.current.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="settings-title">{t('你的页面，你做决定。')}</h2>
        <p>{t('本地页面也可能有密钥、客户信息或未公开的作品。')}</p>
        <label className="setting-toggle">
          <div>
            <strong>{t('允许本机截图')}</strong>
            <span>{t('开启后，仍需逐张点击卡片上的截图按钮。')}</span>
          </div>
          <input
            type="checkbox"
            aria-label={t('允许本机截图')}
            checked={pendingScreenshots ?? library?.screenshotsEnabled ?? false}
            disabled={disabled || !library}
            onChange={async (event) => {
              const enabled = event.target.checked;
              if (!enabled) {
                const decision = await ask({
                  title: t('关闭截图并删除全部封面？'),
                  description: t(
                    '关闭全局截图许可，同时永久删除当前资料库全部已保存截图。项目记录、收藏和目录关联保留。',
                  ),
                  note: t(
                    '此操作无法撤销，不影响已导出的备份；重新开启后仍需逐卡生成截图。',
                  ),
                  confirmLabel: t('关闭并删除全部截图'),
                  destructive: true,
                });
                if (!decision.confirmed) return;
              }
              setPendingScreenshots(enabled);
              await action('settings', 'settings', 'PATCH', {
                screenshotsEnabled: enabled,
              });
              setPendingScreenshots(null);
            }}
          />
        </label>
        <label className="setting-toggle">
          <div>
            <strong>{t('前台自动发现')}</strong>
            <span>{t('项目库在前台时每 20 秒发现；编辑或弹窗期间暂停。')}</span>
          </div>
          <input
            type="checkbox"
            aria-label={t('前台自动发现')}
            checked={pendingAutoRefresh ?? library?.autoRefresh !== false}
            disabled={disabled || !library}
            onChange={async (event) => {
              const enabled = event.target.checked;
              setPendingAutoRefresh(enabled);
              await action('auto-refresh', 'settings', 'PATCH', {
                autoRefresh: enabled,
              });
              setPendingAutoRefresh(null);
            }}
          />
        </label>
        <div className="privacy-note">
          <Icon name="shield" size={22} />
          <div>
            <strong>{t('不上传，不复用登录状态。')}</strong>
            <p>
              {t(
                '截图使用独立浏览器，拦截远程资源与 WebSocket；页面外观可能与日常浏览器不同。关闭开关会删除全部已保存截图。',
              )}
            </p>
          </div>
        </div>
        <p className="small-print">
          {t(
            '资料库默认在 ~/.locade。扫描读取监听进程、工作目录与必要的项目 / Git 元数据并发送网页请求，不会执行项目脚本或启动、停止进程。本机工具不是多用户安全沙箱。',
          )}
        </p>
        <LibraryTools
          library={library}
          disabled={disabled}
          action={action}
          getToken={() => token.current}
          onRestore={(result) => {
            token.current = result.token;
            setLibrary(result);
            setTab('all');
          }}
          reportError={setError}
          onWorking={setBusy}
        />
        {error && (
          <p role="alert" className="notice error">
            {t(error)}
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {t(notice)}
          </p>
        )}
        <div className="dialog-actions">
          <button
            className="button primary"
            onClick={() => settingsDialog.current.close()}
          >
            {t('知道了')}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function ProjectCard({
  project,
  disabled,
  busy,
  screenshotsEnabled,
  action,
  sameNameCount,
  reviewDuplicates,
  showDetails,
}) {
  const { t, locale } = useI18n();
  const date = (value) => formatLocalDate(value, locale, t('尚未扫描'));
  const ask = useConfirmation();
  const [name, setName] = useState(project.name);
  const [nameError, setNameError] = useState('');
  const [brokenImage, setBrokenImage] = useState(false);
  useEffect(() => setBrokenImage(false), [project.screenshot]);
  const base = `projects/${project.id}`;
  const url = new URL(project.url);
  return (
    <article
      data-project-id={project.id}
      className={`project-card ${project.online ? '' : 'offline'}`}
    >
      <div className="cover">
        {project.screenshot && !brokenImage ? (
          <img
            className="screenshot"
            src={`/screenshots/${project.id}.png?v=${encodeURIComponent(project.screenshot)}`}
            alt={t('{0} 的本机页面截图', [project.name])}
            onError={() => setBrokenImage(true)}
          />
        ) : (
          <div className="placeholder">
            <span className="cover-label">
              {project.online ? 'READY WHEN YOU ARE' : 'SAVED FOR LATER'}
            </span>
            <img src="/brand/locade-icon-mono.svg" alt="" />
            <code>
              :{url.port || (url.protocol === 'https:' ? '443' : '80')}
            </code>
            <span className="cover-caption">
              {brokenImage
                ? t('截图文件不可用 · 可重新生成')
                : t('真实页面，等你按下快门')}
            </span>
          </div>
        )}
        <span className={`status-pill ${project.online ? 'online' : ''}`}>
          <span className="status-dot" />
          {project.online
            ? t('运行中')
            : project.status === 'offline'
              ? t('离线保留')
              : t('未确认在线')}
        </span>
        <button
          className={`favorite icon-button ${project.favorite ? 'is-favorite' : ''}`}
          aria-label={`${project.favorite ? t('取消收藏') : t('收藏')} ${project.name}`}
          aria-pressed={project.favorite}
          disabled={disabled}
          onClick={() =>
            action(`favorite-${project.id}`, base, 'PATCH', {
              favorite: !project.favorite,
            })
          }
        >
          <Icon name="star" size={18} />
        </button>
      </div>
      <div className="card-content">
        <div className="card-title">
          <h3 title={project.name}>{project.name}</h3>
          <details className="card-menu">
            <summary aria-label={t('{0} 的更多操作', [project.name])}>
              ···
            </summary>
            <div className="menu-content">
              <form
                noValidate
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!name.trim()) {
                    setNameError(t('项目名称需要 1–100 个字符。'));
                    return;
                  }
                  setNameError('');
                  if (
                    !(await action(`rename-${project.id}`, base, 'PATCH', {
                      name,
                    }))
                  )
                    setNameError(t('名称未保存，请检查页面错误说明后重试。'));
                }}
              >
                <label>
                  {t('项目名称')}
                  <input
                    aria-label={t('重命名 {0}', [project.name])}
                    value={name}
                    maxLength={100}
                    required
                    onChange={(event) => {
                      setName(event.target.value);
                      setNameError('');
                    }}
                  />
                </label>
                {nameError && (
                  <p role="alert" className="notice error">
                    {t(nameError)}
                  </p>
                )}
                <button disabled={disabled} className="menu-button">
                  {t('保存名称')}
                </button>
              </form>
              <p>
                {t('最近打开：')}
                {date(project.lastOpened)}
              </p>
              <button
                className="menu-button"
                disabled={disabled}
                onClick={showDetails}
              >
                {t('目录、地址与截图权限')}
              </button>
              {project.screenshot && (
                <button
                  className="menu-button"
                  disabled={disabled}
                  onClick={async () => {
                    const decision = await ask({
                      title: t('删除这张本机截图？'),
                      description: t(
                        '仅删除下列项目的现有封面，项目记录、收藏和目录关联保留。',
                      ),
                      items: [projectSummary(project, t)],
                      note: t(
                        '此操作无法撤销。需要时可在允许截图后重新生成，不影响已导出的备份。',
                      ),
                      confirmLabel: t('删除截图'),
                      destructive: true,
                    });
                    if (decision.confirmed)
                      action(
                        `delete-shot-${project.id}`,
                        `${base}/screenshot`,
                        'DELETE',
                      );
                  }}
                >
                  {t('删除本机截图')}
                </button>
              )}
              <button
                className="menu-button danger"
                disabled={disabled}
                onClick={async () => {
                  const decision = await ask({
                    title: t('从资料库移除项目？'),
                    description: t(
                      '删除下列项目的本机记录与截图，不会删除项目目录或停止服务。',
                    ),
                    items: [projectSummary(project, t)],
                    note: t(
                      '此操作无法撤销。仍在运行的项目可能在重新发现时再次出现；若只想隐藏，请使用「忽略此项目」。',
                    ),
                    confirmLabel: t('移除项目与截图'),
                    destructive: true,
                  });
                  if (decision.confirmed)
                    action(`remove-${project.id}`, base, 'DELETE');
                }}
              >
                {t('从资料库移除')}
              </button>
            </div>
          </details>
        </div>
        <p className="card-url" title={project.url}>
          {url.host}
          {url.pathname === '/' ? '' : url.pathname}
          {url.search}
        </p>
        {sameNameCount > 1 && (
          <button
            className="same-name-badge"
            disabled={disabled}
            onClick={reviewDuplicates}
          >
            {t('同名 ')}
            {sameNameCount}
            {t(' 项 · 待核对')}
          </button>
        )}
        <button
          className="project-binding"
          title={project.identity?.directory || t('尚未关联目录')}
          onClick={showDetails}
          aria-label={t('{0} 的目录与详情', [project.name])}
        >
          <span>
            {project.identity
              ? `${project.identity.available === false ? t('目录不可用 · ') : ''}${project.identity.directory.split('/').pop()}`
              : t('关联项目目录')}
          </span>
          <small>
            {project.identity?.branch ||
              (project.identity
                ? project.identity.source === 'manual'
                  ? t('手动')
                  : t('自动')
                : '＋')}
          </small>
        </button>
        <p className="card-record-id">
          {t('记录 ')}
          {project.id.slice(0, 8)}
        </p>
        <div className="card-actions">
          <button
            className="capture-button"
            disabled={
              disabled ||
              !screenshotsEnabled ||
              !project.online ||
              project.captureAllowed === false ||
              project.hidden
            }
            title={
              !screenshotsEnabled
                ? t('先在「隐私与截图」中允许截图')
                : t('截取本机页面，可能包含敏感信息')
            }
            onClick={() =>
              action(`capture-${project.id}`, `${base}/screenshot`)
            }
          >
            <Icon name="camera" size={17} />
            {busy === `capture-${project.id}`
              ? t('截图中…')
              : project.screenshot
                ? t('更新截图')
                : t('生成截图')}
          </button>
          {project.addressReused ? (
            <button type="button" className="open-link" onClick={showDetails}>
              {t('地址已被复用')}
              <Icon name="arrow" size={16} />
            </button>
          ) : (
            <a
              className="open-link"
              href={`/open/${project.id}?lang=${locale}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('打开项目')}
              <Icon name="arrow" size={16} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <ConfirmationProvider>
      <App />
    </ConfirmationProvider>
  </I18nProvider>,
);
