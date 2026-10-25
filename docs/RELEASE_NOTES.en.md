# v0.3.0-alpha.1 · Source Alpha

English | [简体中文](RELEASE_NOTES.md)

Release date: 2026-10-23 (Asia/Shanghai). This is Locade's first source prerelease under MIT, not an accepted native macOS App or completion of the full PRD. There is no npm publication, official App / DMG attachment, or private runtime evidence in the release. This is the **historical Alpha.1** record; see the [unreleased Alpha.2 draft](ALPHA2_RELEASE_NOTES.en.md) for development changes, not another release.

## Included

- Local HTTP(S) project discovery, real screenshot cards, offline retention, search, favorites and recent visits.
- Process / directory and read-only Git identity clues; manual bindings and explicit Finder / VS Code / Cursor entry points.
- Port-move / port-reuse protection and same-name comparison; explicitly selected ignoring / undo, never merging by title alone.
- Global / per-project capture consent, deletion / storage usage, local export / restore, and application-owned confirmation, validation and error pages.
- Public npm by default or an explicitly chosen public npmmirror registry, sharing the lockfile and integrity checks.

## Try The Published Source

macOS Apple Silicon is the tested environment. Node.js 22.13+ is required; Node 24 is recommended:

```sh
git clone --branch v0.3.0-alpha.1 --depth 1 https://github.com/opszn/locade.git
cd locade
npm ci
# Alternative for users who choose the public mirror: npm ci --registry=https://registry.npmmirror.com
npm run build
npm start
```

Screenshots additionally require `npm exec --no -- playwright install chromium`. The npm mirror does not change browser download hosts. Open the loopback address printed in the terminal; capture is off by default and explicit for each project after consent. Without the browser you can still discover, favorite and open. See the [English quick start](QUICK_START.md) and [download-source details (Chinese)](INSTALLATION.md).

The published Alpha.1 UI is Chinese. The English / Chinese UI, first-use guide and data-commit hardening belong to unreleased Alpha.2 development; they are not added retroactively to this tag.

## Verified And Unverified

Before going public, [GitHub CI 39892036075](https://github.com/opszn/locade/actions/runs/39892036075) passed all three configurations: macOS / Node 24 and 26 with npm, plus Node 24 with npmmirror. Each passed **74/74 core, 10/10 browser and 7/7 real system discovery** checks. Runners downloaded matching Chromium for browser tests. Local dual-Node regression and format / public-source checks passed; local browser tests reused matching cached browsers, not a clean download. These results do not prove native or all clean-machine installation acceptance. Every later commit needs its own Actions results.

Known limits: successful HTML only; redirects, login, self-signed HTTPS or remote-resource dependencies can cause omissions / incomplete screenshots. Weak identity can retain conservative duplicates or block old addresses. This is not a malicious-page sandbox, a defect-free guarantee or a human efficiency result.

Swift menu-bar source and packaging tools are reviewable, but old local candidates do not represent current source and native installation acceptance is incomplete. No native download is offered and disabling system security is not required. Native UI / login items, clean machines / Intel Macs, cross-version upgrades, signing / notarization, and real one-week use remain unfinished. See [quality risks (Chinese)](QUALITY.md) and [release status (Chinese)](RELEASE_STATUS.md).

## Privacy And Feedback

Project metadata / screenshots stay local, with no upload or telemetry; no automatic project script execution or stopping external services. `~/.locade/` and exports can contain private paths or images: do not submit them to an issue.

The README image is controlled test content, not a user's projects. Use [privacy-safe feedback](FEEDBACK.md) for ordinary problems and [private vulnerability reporting](https://github.com/opszn/locade/security/advisories/new) for sensitive security concerns. Read the [security policy (Chinese)](../SECURITY.md); do not publish secrets or real data.
