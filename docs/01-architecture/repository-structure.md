# Repository Structure

One monorepo. Packages with enforced boundaries: cross-package imports go
through `contracts` only (lint rule + CI check).

```
lusora/
  contracts/                  # THE source of truth (importable by TS and Py)
    schemas/
      beat_sheet.schema.json
      edit_plan.schema.json
      theme.schema.json
      style_pack.schema.json
      channel_config.schema.json
      catalog_entry.schema.json
      renderer_interface.json
      cost_event.schema.json
      prompt.schema.json
      sound_pack.schema.json
      pipeline_manifest.schema.json
    pipelines/                # the stage list as data (D60): one <name>.yaml
      faceless.yaml           #   per pipeline, selected at enqueue
    prompts/                  # agent prompts as data (D42): roles.json (the
      roles.json              #   variable contract), welded/ (the contract
      welded/                 #   halves, code-appended, never UI-editable),
      script/ planner/ chat/  #   and one editable document per prompt
    db/                       # SQL migrations (the DB schema IS a contract)
    api/                      # OpenAPI spec / shared API types
  platform/                   # TypeScript
    web/                      # UI (screens, beat editor, timeline, chat)
    api/                      # HTTP API, auth, roles, queue endpoints
  worker/                     # Python
    pipeline/                 # orchestrator + stages
    agents/                   # bounded agents: script, planner, (chat backend)
    compiler/                 # beats + SRT + style pack -> edit plan
    providers/                # llm/ tts/ image_gen/ stock/ library/ 
  engine/                     # TypeScript, consumed 2 ways:
    src/renderers/ffmpeg/     #   CLI by worker (render)
    src/renderers/remotion/   #   npm package by platform (editor preview)
    src/components/           # catalog components, themeable
    src/themes/               # theme runtime (tokens -> component styling)
    packs/<pack-name>/        # per-channel component packs (versioned)
  library/broll-engine/       # the b-roll library, a git submodule (D71)
  deploy/
    docker-compose.yml        # postgres + api + worker + web (+ library)
  docs/                       # THIS documentation
```

## Rules

- `contracts` has no dependencies and imports nothing from siblings.
- `platform` and `worker` never import each other; they meet in the DB,
  the API, and the video folder.
- `engine` is imported by `platform` (components + Player for the editor)
  and invoked by `worker` (CLI). It never touches the network or the DB.
- `library` keeps its own API; `worker` and `platform` reach it via HTTP
  only (see [B-roll Library](../02-components/broll-library.md)).

## Tooling (proposed, OQ-3)

pnpm workspaces for TS; uv for Python; one CI workflow running: schema
validation, TS typecheck+tests, Py tests, engine contract test
(fixture render + ffprobe), lint boundaries.
