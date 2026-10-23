# Locade project instructions

## Start here

- Read `README.md` and `docs/PROJECT_CONTEXT.md` before planning or changing code.
- Inspect `design/brand/preview.png` when working on the interface or identity.
- The handoff distinguishes user preferences, proposals, and implemented work. Preserve that distinction.
- This repository starts with brand assets and planning only, not an implemented app.

## Product and design

- Locade is a local-first visual library of development projects, not a deployment platform.
- First target: discover local HTTP projects, show screenshot cards, and open projects.
- Prefer the existing warm-paper, charcoal, orange-red visual direction; do not replace the logo without a user request.
- Keep in-app confirmation, validation, progress, success, and error feedback in Locade-owned UI. Do not use browser alert/confirm/prompt or native form-validation bubbles. File selection/download and explicitly opening a project or editor may still use the browser/OS integration; never fake those permissions.
- Brand assets are vector paths. `tools/build_brand.py` reproduces SVG/HTML but not PNG previews.
- Keep regenerated assets and their generator consistent; do not accidentally overwrite manual design changes.

## Safety and scope

- Bind management endpoints to loopback by default.
- Never execute discovered project scripts automatically; require user confirmation of startup commands.
- Only stop processes launched and tracked by Locade itself.
- Keep screenshots local and plan for opt-out/deletion because local pages may contain secrets.
- Do not assume the name, npm package, domain, or trademark has been cleared.
- No license or remote repository is selected yet. Do not publish or choose a license without user direction.

## Continuity

- Keep user-facing project notes in Chinese unless requested otherwise.
- Update the handoff after meaningful product or engineering decisions so later sessions can resume accurately.
- Never claim app functionality or tests exist merely because they appear in the proposed roadmap.
