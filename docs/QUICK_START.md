# Quick Start

English | [简体中文](QUICK_START.zh-CN.md)

Updated 2026-10-25. The published source release is **v0.3.0-alpha.1**. Alpha.2 changes are merged into `main` but remain **unreleased development**, not an App download. This guide separates both so you can tell which instructions apply.

## 1. Install The Published Source

Use macOS on Apple Silicon and Node.js **22.13+**; Node 24 is recommended and Node 26 is also tested. Other platforms and Intel Macs are not yet accepted. `lsof` enables process-based discovery; without it, discovery probes common ports only. Locade does not install Node or start your projects for you.

For a reproducible Alpha.1 checkout in a new folder:

**If you have already used Alpha.2 development, do not run this older checkout against its v3 library.** Use a separate empty data directory as shown below; read the migration / backup guidance before returning to old source. A new source folder alone does not isolate the default `~/.locade/` data.

```sh
git clone --branch v0.3.0-alpha.1 --depth 1 https://github.com/opszn/locade.git
cd locade
```

Choose **one** npm dependency source. Both use the same lockfile and integrity checks, without global npm configuration changes:

```sh
# Default: public npm registry
npm ci

# Alternative: public third-party npmmirror registry
npm ci --registry=https://registry.npmmirror.com
```

Do not run `npm ci` against a checkout while a service uses its `node_modules`. No automatic registry fallback or TLS downgrade is performed. The npm mirror **does not change the browser download** host.

```sh
npm run build
npm start
```

Open the loopback address printed by the terminal, normally `http://127.0.0.1:4400`. Keep that terminal running; Ctrl+C there stops the Locade service, not your external projects. If the port is occupied, do not kill an unknown process. An independent library and port can be used instead:

```sh
PORT=4401 LOCADE_DATA_DIR="$PWD/.locade" npm start
```

Only one instance can own a data directory. Default data lives in `~/.locade/`, not necessarily inside this checkout. Never expose the management service through a proxy or tunnel.

## 2. Discover, Capture If You Choose, Then Open

Start your own local web project in your usual terminal or IDE first. Locade never executes its startup scripts or stops it. Open the library to discover, or use Rediscover; visible, idle pages normally refresh every 20 seconds. You can turn foreground refresh off in settings. This is a recent probe result, not a live guarantee.

Alpha.1 uses Chinese labels. Unreleased Alpha.2 development on `main` adds the English equivalents shown here; a pinned Alpha.1 checkout will not show a language picker or the new guide.

| Task | Alpha.1 Chinese label | Alpha.2 English label |
| ---- | --------------------- | -------------------- |
| Add a final local HTML address | 添加项目 | Add project |
| Discover again | 重新发现 | Rediscover |
| Manage consent | 隐私与截图 | **Privacy & screenshots** |
| Enable screenshot permission | 允许本机截图 | **Allow local screenshots** |
| Capture one card | 生成截图 | **Capture screenshot** |
| Open the verified project | 打开项目 | **Open project** |
| Compare duplicates without merging | 同名待核对 | **Review same names** |

Without Chromium you can still discover, favorite, and open projects. Screenshots are off by default. Installing Chromium does **not** enable consent or capture every project. If you want a cover, install the matching browser manually in the Locade source directory:

```sh
npm exec --no -- playwright install chromium
```

Review the page for secrets, enable permission in settings, then capture that card explicitly. Per-project consent can stay disabled. Your everyday browser's login state is not reused; only loopback resources are allowed, so login, remote CDNs / APIs, or WebSockets may render incompletely. Do not use sensitive or untrusted pages just to try the feature.

Use the card's Open project action rather than an old raw URL. Known reused addresses are blocked; rediscover the original project rather than dismissing that safety check. Repeated titles alone do not prove identity: compare cards by directory, address, owner evidence and cover. Nothing is auto-merged. An offline card is still saved; Locade will not restart it.

## 3. What Changes In Alpha.2 Development

These features require the relevant development commits, not just an Alpha.1 version number. Read the [unreleased notes](ALPHA2_RELEASE_NOTES.en.md) before trying development source. The reviewed candidate merged into `main` at `7780323`; it is not a release tag. For an optional isolated tryout, use a **new source folder and separate empty data directory**, not your everyday library:

```sh
git clone https://github.com/opszn/locade.git locade-alpha2
cd locade-alpha2
git checkout --detach 77803231e286d8036265e913cf2743f0f31c745c
```

Choose one `npm ci` option from section 1 in this new folder, then:

```sh
npm run build
PORT=4401 LOCADE_DATA_DIR="$PWD/.locade" npm start
```

If that port is occupied, choose another unused port; never stop an unknown service. Optional Chromium installation and explicit screenshot consent still apply. These commands are instructions, not evidence of an independent person's installation or a started one-week study.

- **Quick start** reopens the dismissible first-use guide. A language picker follows supported browser languages or a local explicit choice. Project names, paths, and Git branches are not translated.
- Screenshot browser readiness checks executable files only; it does not prove the browser can launch under your system policy. Retry checks do not install or execute a browser. A missing browser does not disable discovery, favorites or opening.
- A visible cleanup warning means some old or partial images remain on disk. **Retry image cleanup** retries deletion; do not claim privacy deletion succeeded or share the data directory before cleanup finishes. Failed metadata commits keep the original cover; cleanup after a successful commit can still fail. Raw filesystem errors may remain untranslated.
- Local library format is **v3**, with independent image revisions. Original v1 / v2 metadata copies are preserved before migration; legacy cover filenames stay unchanged. An old source version cannot directly read / write a v3 library. A migration JSON copy is not an image backup.
- Before returning to older code, export a backup with the newer source and restore it into a **separate empty data directory**. Exported archives still contain compatible **v2** state. Include images only if you explicitly want them and keep that backup private. Do not replace a live library with old JSON or point an old App at the upgraded directory.

## 4. Common Problems And Safe Next Steps

| Symptom | Next step |
| ------- | --------- |
| Nothing found | Confirm the project is already running and returns successful HTML; manually add its final local address including the path. Redirects, JSON-only responses, self-signed HTTPS and authenticated pages may not be discovered. |
| Browser missing or download fails | Keep using discovery / favorites / opening. Browser installation is a separate download from npm; see [installation sources](INSTALLATION.md) for details. Do not disable TLS or system security. |
| Browser files found, but capture fails | File readiness is not launch acceptance. Read the in-app error, check the page / trusted network setup, or open it directly. Do not move, re-sign or repeatedly launch blocked native applications to evade policy. |
| Wrong project, unexpected cover or suspected data loss | Stop destructive actions; do not delete / merge real cards or restore over the library to conceal the symptom. Report an anonymous sequence of steps and a short sanitized error code. |
| Service unavailable | Check the terminal you started. Alpha.2 has an in-app reconnect action; Alpha.1 can be reloaded after the local service is ready. Do not kill unknown processes. |

## 5. Keep Control Of Your Data

Screenshots and metadata stay local; there is no telemetry or screenshot upload. They can contain paths, addresses and secrets. Ignoring a card hides it but does not delete its image. Screenshots do not expire automatically. Disabling consent requests deletion; on Alpha.2, any cleanup failure remains visible and retryable. Exported or system backups are outside app deletion.

Export / restore controls are in privacy settings. Restoring **replaces**, rather than appends to, the library. Image restoration is a separate checkbox, off by default. `before-restore.json` contains only metadata, not the old images; do not rely on it to undo lost covers. Stopping the service and removing the source checkout does not remove `~/.locade/` or exported backups.

For ordinary issues or first-use friction, read [privacy-safe feedback](FEEDBACK.md). For a vulnerability or private data exposure, use [GitHub's private security report](https://github.com/opszn/locade/security/advisories/new), not a public issue. Do not post real paths, screenshots, library files, backups, credentials or session tokens.

This guide is not evidence of an independent participant's success, a one-week study, or native acceptance. There is no official App / DMG download or npm release. See [published Alpha.1 notes](RELEASE_NOTES.en.md) and the [Alpha.2 plan (Chinese)](ALPHA2_PLAN.md).
