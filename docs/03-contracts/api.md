# API Surface — Draft v1

HTTP/JSON, cookie-session auth (OQ-5), role-checked per route. OpenAPI
spec lives in `contracts/api/`. Sketch of the v1 surface:

```
AUTH      POST /auth/login  /auth/logout        GET /auth/me

CHANNELS  GET/POST /channels            GET/PATCH /channels/:id
          GET /channels/:id/costs      GET/PUT /channels/:id/team
          GET/PUT /channels/:id/config          (schema-validated)

QUEUE     POST /videos                  (create draft; multipart uploads:
                                         script | audio | avatar_video | beats | plan)
          POST /videos/:id/enqueue      (pre-flight validate → snapshot cfg → QUEUED)
          POST /videos/enqueue-batch    (per-item results, partial success)

VIDEOS    GET /videos?channel&status&…  GET /videos/:id
          GET /videos/:id/events        GET /videos/:id/assets
          GET /videos/:id/stream        (final.mp4 range requests)
          GET /videos/:id/files/*path   (any video-folder artifact, range
                                         requests; the editor's Player
                                         preview loads clips/audio here)
          POST /videos/:id/transition   {to: approved|sent_back|posted|queued}
          POST /videos/:id/notes

EDITOR    GET/PUT /videos/:id/beats     (beats.json through the API; PUT
                                         validates + triggers per-beat recompile)
          GET/PATCH /videos/:id/plan    (validated ops; timing/asset/transform
                                         edits set locked; set_lock toggles
                                         it explicitly — unlock lets the next
                                         recompile replace the item)
          POST /videos/:id/beats/:beatId/reroll   (re-run resolution for one beat)
          POST /videos/:id/chat         (editor agent: returns proposed ops +
                                         validation result; apply is a second call)

CATALOG   GET /catalog                  (merged core + data packs, each entry
                                         flagged implemented / unimplemented)
          POST /catalog                 GET/PUT/DELETE /catalog/:name
          PUT /catalog/:name/style-packs        (per-style-pack overrides)
          GET/POST /catalog/packs       (list packs w/ counts; import a whole
                                         pack atomically — all entries valid
                                         or nothing is written)
          GET/PUT/DELETE /catalog/packs/:pack   (round-trip a pack as a file)

THEMES    GET/POST /themes              GET/PUT /themes/:name

STYLE     GET/POST /style-packs         (list w/ schema errors + referencing
PACKS                                    channels; create a pack file)
          GET/PUT/DELETE /style-packs/:name
                                        (PUT replaces the whole document —
                                         the name is the filename and cannot
                                         change; DELETE refuses while a
                                         channel still references it)

CONFIG    GET /config-options           (enumerable channel-config values read
                                         from the contracts data files: themes,
                                         style packs — with the video_type each
                                         declares — and component packs)
          GET /users                    (id/email/name/role for team pickers)

LIBRARY   Proxied 1:1 to the broll library API under /library/*
          (search, segments, clips, thumbs, jobs, uploads, profiles)

MONITOR   GET /monitor/pipeline  /monitor/providers  /monitor/costs
          GET /monitor/storage   /monitor/workers

ADMIN     GET/POST /admin/users          PATCH /admin/users/:id
          GET /admin/providers           (health only — never secret values)
```

## Notes

- Every mutating route writes an event or is idempotent; batch enqueue
  returns per-video validation errors instead of failing the batch.
- The chat endpoint NEVER applies changes directly: it proposes
  operations, the client shows the validated diff, apply is explicit —
  same constrain/validate/repair principle, with the human as the final
  gate.
- File uploads at creation are the manual-first path: any artifact
  provided is materialized into the folder and its stage auto-skips.
- Catalog and theme writes go to the contracts data files, not the DB:
  they are the same artifacts the engine and worker read, so an edit in
  the UI is an edit to the contract. Reads are open to any signed-in
  user; every write requires `manager`.
- Component packs are the extension seam — core ships in the engine,
  everything else is a data pack under `contracts/component-packs/`.
  An entry may be catalogued before it is implemented; `/catalog`
  reports which, so the planner never proposes a component the
  renderer cannot draw.
