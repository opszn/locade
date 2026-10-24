# Locade

English | [简体中文](README.zh-CN.md)

> Your localhost, ready to play.

A local-first visual library for your development projects. Recognize what you
built from real screenshots, keep it in your collection, and find your way back.

**v0.3.0-alpha.1 · macOS-first · Local storage · MIT.** Use the source-based web
app for now. Locade is neither a deployment platform nor a project process
manager. The menu-bar source and packaging tools exist, but native installation
has not passed acceptance. There is no official App / DMG download or published
`npx locade` command.

The published Alpha.1 application interface and most detailed documentation are in
Simplified Chinese. Development toward Alpha.2 adds a Chinese / English web UI
and first-use guidance; see the [plan and implementation status](docs/ALPHA2_PLAN.md).
These development changes are not a new release or native app acceptance.

[Step-by-step quick start](docs/QUICK_START.md) · [Feedback and privacy](docs/FEEDBACK.md) ·
[Alpha.1 release notes](docs/RELEASE_NOTES.en.md) · [Alpha.2 unreleased draft](docs/ALPHA2_RELEASE_NOTES.en.md)

Alpha.2 development also hardens data and screenshot commits. Its local library
format is v3; legacy covers keep their filenames, and an original metadata copy
is kept before migration. Older source must not write to this upgraded directory.
Exported backups still contain compatible v2 data; restore them into a separate
empty directory when returning to older code. See [failure recovery and limits
(Chinese)](docs/DATA_INTEGRITY.md).

[GitHub repository](https://github.com/opszn/locade) ·
[Source Alpha release](https://github.com/opszn/locade/releases/tag/v0.3.0-alpha.1)

![Locade's web project library, showing isolated test projects](design/screenshots/library.png)

The screenshot shows isolated test pages and temporary directories, not a user's
private projects, screenshots, or built-in demo content. See the original
[brand exploration](design/brand/preview.png).

## What It Does

- Discover local HTTP(S) pages and find projects by screenshot, name, favorites,
  search, or recent visits. Keep cards and covers when a project goes offline.
- Associate projects with process working directories and read-only Git branch
  information. Bind directories manually and explicitly open Finder, VS Code, or
  Cursor.
- Treat projects and addresses separately: retain identity across port changes
  where evidence permits, and block stale cards from opening a reused address or
  inheriting another project's cover. Handle uncertain identity conservatively.
- Compare same-name records by directory, address, and cover. Ignore only the
  records you explicitly select, with undo and restore; never merge or remove
  historical cards just because their titles match.
- Control screenshots globally and per project, delete covers, inspect storage,
  and export or restore local backups. Locade owns its confirmation, validation,
  and error UI rather than relying on browser dialogs.

The intended product is a **macOS menu-bar entry point + local core + full project
library in your browser**. The source-based web app is the current usable entry
point. Compiling the menu bar is not the same as validating the native experience.

## Quick Start

Requires **Node.js 22.13+**. Node 24 is recommended; Node 26 is also covered by
regression tests. The tested environment is macOS on Apple Silicon. Other
platforms and architectures are not yet guaranteed. Discovery uses the system
`lsof`; if unavailable, it falls back to probing common ports only.

Clone the repository, then choose one dependency source. **No global npm
configuration changes are needed.**

```sh
git clone https://github.com/opszn/locade.git
cd locade
```

```sh
# Default: the public npm registry
npm ci

# Or: the public npmmirror registry, a third-party option for users in China
npm ci --registry=https://registry.npmmirror.com
```

Both use the same `package-lock.json`, dependency versions, and integrity checks.
Neither requires a corporate registry or private account. There is no automatic
registry fallback; explicitly select the official registry if the mirror is
unavailable. See [installation and download sources (Chinese)](docs/INSTALLATION.md).

```sh
npm run build
npm start
```

Open the address printed in the terminal, normally `http://127.0.0.1:4400`.
The first visit triggers discovery. By default, it refreshes every 20 seconds
while the page is visible and no edit or dialog is active; you can disable this
in the library tools. Online status reflects the most recent probe, not a live
guarantee.

Install the matching Playwright Chromium before taking screenshots:

```sh
npm exec --no -- playwright install chromium
```

**An npm mirror does not change the browser download host.** Chromium still uses
Playwright's configured download service. Without it, you can still discover,
favorite, and open projects. Screenshots are disabled by default and require an
explicit per-project action even after permission is enabled; no automatic bulk
capture occurs.

Data is stored in `~/.locade/` by default. To use an isolated library or a different
port:

```sh
PORT=4401 LOCADE_DATA_DIR="$PWD/.locade" npm start
```

Only one current-version instance can own a data directory. Close the previous
service before upgrading. `PORT=0` requests a dynamically assigned loopback port.

## Privacy and Boundaries

- The management service binds only to `127.0.0.1`, validates Host / Origin /
  Fetch Metadata and a session mutation token, and does not enable CORS. Do not
  expose it to a network through a proxy.
- No automatic project script execution, stopping external services, screenshot
  uploads, telemetry, cloud sync, or public tunnels.
- Only limited process cwd, start-time, directory-marker, and Git HEAD metadata
  is read. There is no full-disk scan or execution of Git or hooks. Monorepos,
  worktrees, and concurrent services in one directory are not merged solely by
  repository root.
- Discovery sends real GET requests and accepts successful HTML only. It does
  not follow redirects, accept self-signed HTTPS, or reuse authenticated browser
  sessions. Add the final HTML address manually if discovery misses it.
- Screenshot resources are restricted to loopback; your everyday browser's login
  state is not reused. Pages depending on remote CDNs / APIs, WebSockets, or login
  may render incompletely. This is not a sandbox for malicious pages.
- Disabling screenshots globally deletes all current covers; disabling them for
  one project deletes that project's cover. Screenshots do not expire by default.
  Deleting inside the app does not remove previously exported backups.
- Weak identity evidence or transient races can still leave conservative
  duplicates or block a stale address. Matching titles do not establish matching
  projects; retaining old records is not a promise of automatic deduplication.

## Development and Verification

```sh
npm run check:source      # Public registry lock, source manifest, limited sensitive-data checks
npm run format:check
npm test                 # Core, API, network, safety, and release guards
npm run test:ui           # Build and real Chromium browser workflows
npm run test:discovery    # Real macOS lsof / cwd / Git identity checks
npm run dev              # Build and watch the server; rebuild after frontend changes
```

Tests use isolated data directories, controlled pages, and owned processes.
Application browser tests reject native alert / confirm / prompt dialogs. File
selection, downloads, and explicitly opening a project or editor still use normal
browser and OS integrations. Do not run an auto-discovering everyday Locade
instance alongside root-path HTML fixtures, or it may collect test pages.

Before the first public release,
[GitHub CI run 39892036075](https://github.com/opszn/locade/actions/runs/39892036075)
passed all three macOS configurations: Node 24 / 26 with npm, and Node 24 with
npmmirror. Each passed **74/74 core tests, 10/10 browser tests, and 7/7 real system
discovery checks**. Runners also downloaded matching Chromium / headless shell
builds. These are source CI results, not native app acceptance or coverage of
every clean target machine. Local regression on both Node versions also passed.
See the [acceptance record (Chinese)](docs/ACCEPTANCE.md) for scope and limitations;
use [Actions](https://github.com/opszn/locade/actions) for each subsequent commit's
results.

## Documentation and Status

Quick-start and release notes are available in both languages; the detailed
engineering notes are currently in Chinese:

[Product requirements](docs/PRD.md) · [Installation](docs/INSTALLATION.md) ·
[Known risks](docs/QUALITY.md) · [Interaction acceptance](docs/INTERACTION_AUDIT.md) ·
[macOS builds](docs/MACOS.md) · [Release status](docs/RELEASE_STATUS.md) ·
[One-week tryout](docs/TRYOUT.md) · [Historical performance](docs/PERFORMANCE.md) ·
[Competitor research](docs/COMPETITIVE_RESEARCH.md) · [Project handoff](docs/PROJECT_CONTEXT.md)

Directories: `src/` frontend, `server/` local core, `macos/` native shell, `tests/`
tests, `tools/` build and verification tools, and `design/brand/` original brand
exploration.

## License and Release Status

Locade uses the [MIT License](LICENSE). Third-party dependencies retain their own
licenses. `private: true` only prevents accidental npm publication; it does not
restrict this repository's MIT license. No npm package has been published. The
name, npm package name, domain, and trademark have not been cleared.

[opszn/locade](https://github.com/opszn/locade) became public after its private CI
passed. Official App distribution, Developer ID signing / notarization, login-item
and clean-machine acceptance, the full PRD, and a real one-week usage study are
still unfinished. Existing local App / DMG builds do not represent the latest
source and are not attached to this release. See the
[Alpha release notes](docs/RELEASE_NOTES.en.md).

Read [Contributing (Chinese)](CONTRIBUTING.md) before contributing, and
[Security (Chinese)](SECURITY.md) before reporting a security issue. Use
[GitHub's private vulnerability reporting](https://github.com/opszn/locade/security/advisories/new)
for sensitive reports; do not post private project data or credentials publicly.
Use the [feedback guide](docs/FEEDBACK.md) for anonymous ordinary reports. The new
GitHub templates take effect only after merging into the default branch; they do
not automatically redact attachments or text.
