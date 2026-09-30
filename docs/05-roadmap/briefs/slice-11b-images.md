# Slice 11b: Nano Banana images and an image chain (M)

Read [the briefs README](README.md) and
[11a](slice-11a-gemini-chains.md) first: this reuses 11a's quota ledger. Codex
images are in [11c](slice-11c-codex-cli.md), since they need the Codex CLI.

## Goal

The `ai_image` source (`worker/lusora_worker/providers/sources.py`, class
`AiImageAdapter`, around line 735) gains:

1. A provider `nano_banana`: Gemini's image model through the same API and key
   as 11a (`GEMINI_API_KEY`).
2. A **provider chain** like 11a's: `"provider": ["nano_banana", "openai"]`
   tries each in turn, skipping providers the quota ledger marks out. A plain
   string works as today.

## Dark Palace sources (read-only)

`/home/thiago/darkpalace/DOCGERAL_STUDIO/motor/gemini_esp.py`:
- `gera_imagem_api` (line 810): one image, an optional reference image
  first, the prompt as text; the answer's first `inlineData` image is written
  to disk; a file under 100 bytes counts as a failure;
- `candidatos("imagem")` / `escolhe_modelo("imagem")`: which image models the
  key has. A 429 with `limit: 0` means the free tier has no image quota at all
  (`_e_cota_do_dia`), so mark the provider out until tomorrow.

## How

- `AiImageAdapter.resolve`: `provider` may be a list (reuse `llm.chain_of`
  from 11a). Loop over the elements, skip ones `quota.out_reason(...)`
  returns a reason for, and call `_mock` / `_openai` / `_nano_banana`. The
  first `Resolution` wins. A refusal returns `None` and moves on, exactly as
  `_openai` does today.
- `_nano_banana(ctx, item, query, prompt)`:
  - `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`,
    key in the `x-goog-api-key` header;
  - body `{"contents":[{"parts":[{"text": prompt}]}], "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "16:9"}}}`.
    Take the aspect from `image_aspect(ctx.cfg)` (already in `sources.py`)
    mapped to `"16:9"` / `"9:16"` / `"1:1"`;
  - model: env `GEMINI_IMAGE_MODEL`, else the newest image model the key lists
    (`GET /v1beta/models`, a name containing `image`). Cache the listing for
    the process;
  - write `clips/<item id>.png`, wrapped in `budget_gate(... provider="nano_banana", operation="image.generate" ...)`;
  - a 429 or 403: `quota.classify(...)`, mark out, `provider_health(... False ...)`, return `None`.
- **Schema**: `source_policy.visual.chain[].provider` (around line 608 of
  `channel_config.schema.json`) becomes string-or-array like 11a's `llm`.
  Update the TypeScript type too.
- **Prices**: `image.generate` for `nano_banana` in `contracts/prices.json`
  (two blocks have `image.generate`, around lines 6 and 402; read both to see
  the pattern). **Ask the user** whether their key's image use is free-tier (0)
  or paid.
- **Platform**: wherever the channel form edits an `ai_image` chain entry's
  provider, add `nano_banana`, and keep a list value as comma-separated text
  (the 11a pattern).

## Tests (`worker/tests/test_ai_image.py`, or extend the existing ai_image tests: `grep -rn "AiImageAdapter\|ai_image" worker/tests`)

- A faked Gemini answer with one `inlineData` PNG → a `Resolution` with
  `provider="nano_banana"`, the file written, and a completed cost event.
- An answer with no image → `None`, no file, and the chain moves to the next
  provider.
- A 429 whose body says `limit: 0` → the ledger marks `nano_banana` out until
  tomorrow, and the next item doesn't call it.
- A plain string `"openai"` behaves exactly as before.

## Real-call check (allowed, tiny)

One real image: prompt "a dark coal mining town street at dusk, 1960s
photograph", 16:9. Open the file and look at it. Report the model used and the
file size, never the key.

## Benchmark (optional)

The Centralia render's chain ends in `{"source": "ai_image", "provider": "mock"}`,
so no shot reaches it today. To see a real image in context, fork
`vid_dfd49c6c34e4` with that last chain entry's provider set to `"nano_banana"`
and the entries before it removed for one test render. That costs one image
per shot, so **ask the user first**.

## Docs

Next free D number; `docs/03-contracts/channel-config.md` (the `ai_image`
provider list); the plan's slice 11 list.
