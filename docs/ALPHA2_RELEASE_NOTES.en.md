# Alpha.2 · Unreleased draft

English | [简体中文](ALPHA2_RELEASE_NOTES.md)

Updated 2026-10-25. **Unreleased draft — no Alpha.2 release, tag, npm package or native download is created by this document.** The published source remains **v0.3.0-alpha.1**. Package metadata in development still uses that version; identify development behavior by branch + commit. These notes describe source merged into `main`, not native app acceptance or the entire PRD being complete.

## Source Changes Merged Into `main`

Packaging preparation now assigns **v0.3.0-alpha.2** to the candidate, not an Alpha.1 version string. See [native candidate status](MACOS_ALPHA2_PREVIEW.md). A version bump or a draft is not a published release; package validation and explicit publication are separate.

- [PR #6](https://github.com/opszn/locade/pull/6): Chinese / English web UI, explicit local language preference or browser language, dates, known errors, ten confirmation classes and navigation failure pages. User names / paths / branches are not translated; unknown external diagnostics stay verbatim. No menu-bar translation or execution is claimed.
- The dismissible / reopenable first-use guide explains discovery and explicit screenshot consent, shows a read-only browser-file readiness check, a fixed manual install command and retry paths. It does not download, install, launch the checked browser, turn on consent or reuse browser login state. Initial service connection can be retried in the app.
- [PR #7](https://github.com/opszn/locade/pull/7), stacked on #6: screenshot files have independent revisions; failed metadata commits keep original metadata / covers. Library / image / usage reads use a committed snapshot. Capture checks ownership before and after; uncertainty or reuse blocks replacement rather than inheriting the wrong image.
- Successful metadata commit and incomplete image cleanup are reported separately. In-app Chinese / English warnings expose the filesystem error code and a cleanup retry, including after restart. Unreferenced images are not served; they may still exist on disk until cleanup succeeds. No hidden permanent old-image backup is introduced.
- A2-05 adds paired quick-start / release notes, public bug / first-use Markdown templates and [privacy-safe feedback](FEEDBACK.md). GitHub recognizes both templates on the default branch; direct chooser-page verification timed out on the verification network. Templates are not automatic redaction. Preparing them does not count as a participant or real usage result.

The complete fixed stack merged through #9 → #8 → #7 → #6, with current-head CI checked at every layer. It reached `main` at `76b884e`; the merged file tree matches the reviewed fix. Source integration is not a published Alpha.2 build. [The plan (Chinese)](ALPHA2_PLAN.md) tracks remaining validation.

## Data Migration And Returning To Older Source

- The local library format becomes **v3**; this is separate from the package version. Legacy `UUID.png` covers keep their filenames. Before migrating v2, `library.v2.backup.json` preserves the original metadata without overwriting a prior copy (v1 has its own equivalent). The migration does not copy or secretly retain deleted images.
- Pre-merge review also fixes retries after interruption immediately after publishing a recovery copy: validate an existing copy first, detach stale temporary hard links before making a fresh file, and reject a damaged copy instead of silently rewriting it. Four regressions failed before the fix and passed after, including an actual owned-child interruption / restart; this is not a power-loss guarantee.
- `before-restore.json` is an atomic metadata-only checkpoint; it contains no old image content or image-revision reference. Restore replaces the library, and image restoration is a separate opt-in, off by default.
- Old Alpha.1 source must **not** write to a v3 directory. It rejects the new format; merely replacing JSON from a migration copy cannot recover images already explicitly deleted or replaced.
- To return to older source, export with the newer version and restore into a **separate empty data directory**. Export remains container version 1 with compatible **v2** state, with images only when explicitly selected. Keep exports private and do not point an old App at the upgraded directory.
- On cleanup failure, follow the in-app warning and retry after addressing permissions / storage; do not share the data directory until cleanup finishes. Full detail and test scope are in [data integrity (Chinese)](DATA_INTEGRITY.md) and the [English quick start](QUICK_START.md).

## Evidence, Not A Blanket Guarantee

The A2-04 source commit `882d1806d09d14a6162f7249697757f9908ae315` passed [its PR CI](https://github.com/opszn/locade/actions/runs/39986534011) across macOS Node 24 / 26 with npm and Node 24 with npmmirror: each **118/118 core, 17/17 browser and 7/7 real system discovery**. Local Node 24.22.0 / 26.7.0 matched. These are historical results for that code, not inherited success for this document or later commits; inspect each commit's [Actions](https://github.com/opszn/locade/actions).

The integrated source `76b884eea2d0502b8311f883df459e532c18aded` passed [its main-branch CI](https://github.com/opszn/locade/actions/runs/40165626385): all three configurations each passed **130/130 core, 17/17 browser and 7/7 real system discovery**, with no failures or skips. Later documentation commits must pass their own checks.

Fault coverage includes partial writes / rename / sync / cleanup failures, real owned-directory permission changes and nine owned Node-process interruption points around capture / restore / delete / migration. ENOSPC / EIO were injected, not produced by filling a user's disk. Process SIGKILL is **not a power-loss durability guarantee**; filesystem / hardware failure and all timing races have not been exhausted. Checking ownership before / after also cannot prove every intermediate page identity.

## Still Not Accepted Or Included

- Independent unfamiliar developers installing and trying the flow, and real project one-week use / retrieval comparisons: pending real participation, not replaceable by CI or these documents.
- Official App / DMG distribution, stable native install identity, native UI / login items, signing / notarization, clean machines and cross-version upgrade / uninstall: not accepted; do not publish old artifacts or disable security to test them.
- Platforms beyond tested macOS Apple Silicon, all browsers, all process-discovery cases, and a malicious-page sandbox: not guaranteed.
- No project start / stop manager, arbitrary shell, cloud sync, tunnels, screenshot upload or telemetry is added. Default discovery remains loopback, with the existing Host / Origin / session-token guards.

Do not publish Alpha.2 merely because these notes exist or source was merged. Review the candidate's limits and current CI, keep unverified items explicit, and use [feedback](FEEDBACK.md) or the [private security channel](https://github.com/opszn/locade/security/advisories/new) appropriately.
