# editor-seed

Editor v1 from the previous iteration. Reference/seed for milestone M8 — not
built, not imported. Its `src/api.ts` targets the retired `ui_api` and will be
retargeted to the platform API at M8. The beat panel
(`docs/03-contracts/beat-sheet.md`, editing semantics) will be added then.

It is deliberately excluded from the monorepo's typecheck, build, and lint
(see `platform/tsconfig.json` `exclude` and `scripts/lint-boundaries.mjs`
`skipDirs`) so it cannot rot CI while it sits unwired.

## Provenance

Vite + React + Tailwind + zustand web editor for `edit_plan.json`, lifted from
the `video-engine` repo's `ui/`. In that repo it imported the Remotion
composition from `src/` directly so the `<Player>` preview and the CLI render
shared one `MainComposition` (preview/render parity). When it is revived at M8
it will import the composition from `@lusora/engine` and resolve assets through
the platform API's Range-capable files endpoint instead of the old `ui_api`.
