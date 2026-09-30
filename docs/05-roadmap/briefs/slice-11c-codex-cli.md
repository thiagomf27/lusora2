# Slice 11c: the Codex CLI for text, vision and images (M)

Read [the briefs README](README.md) and
[11a](slice-11a-gemini-chains.md) first (chains, the quota ledger).

## Before anything: the user's step

`codex` is **not installed** on this machine (`which codex` finds nothing).
Stop and ask the user to install it and log in with their ChatGPT account:
`npm i -g @openai/codex`, then `! codex login`, then `codex login status`
must say "Logged in". Don't install it yourself, and never read or copy
anything in `~/.codex` except the `generated_images/` folder described below.

## Goal

A provider `codex_cli` that runs on the user's ChatGPT subscription:

1. **Text and vision** in `worker/lusora_worker/providers/llm.py`, next to
   `claude_cli` (same shape: a `PROVIDERS` entry with no key, `vision=True`, a
   subprocess call, and price 0 with tokens recorded where Codex reports them).
2. **Images** as an `ai_image` provider `codex` in `providers/sources.py`,
   next to 11b's `nano_banana`.

## Dark Palace sources (read-only)

`/home/thiago/darkpalace/DOCGERAL_STUDIO/motor/codex_esp.py` (708 lines) and
`codex_img.py` (197 lines):
- `_argv` (line 344):
  `codex exec --skip-git-repo-check -s <read-only|workspace-write> -C <dir> --color never --json -o <last-message file> [--enable image_generation] [--ephemeral] [-m <model>] -c model_reasoning_effort="<low|medium|high>" [-i <image> ...] -`.
  **The prompt goes on stdin** (the trailing `-`), never in argv;
- `RX_LOGIN`, `RX_COTA`, `RX_SEM_IMAGEM`, `RX_MODELO` (lines 91–101): how a
  failure is classified. Reuse these patterns in 11a's `quota.classify`;
- `logado` (line 191): `codex login status`. Only the category leaves this
  function, never the command's text, since it can contain part of a key;
- `PRESETS` (line 219): the model and effort per task. The user's choice
  there was one model with low effort for vision and medium for text. Model
  names change, so make the model an env var (`CODEX_MODEL`), unset by
  default (the account's default model);
- `_chama` (line 365): retries on an empty answer, but never on a login or
  quota failure;
- images: `gen_image` (line 597) and `_colhe` (line 531) in `codex_esp.py`,
  and `codex_img.py`. Run with `-s workspace-write` inside the output folder
  and `--enable image_generation`, and **say "save it as <key>.png" in the
  prompt** (without it Codex generates but saves nothing). Then take the PNG
  from the work folder, else from `~/.codex/generated_images/<thread id>/`,
  where the thread id is the first `--json` event's session id. Never take
  another session's newest file.

## How

- `_codex_cli(model, system, user, images) -> LLMResult` in `llm.py`,
  modelled on `_claude_cli`:
  - a scratch dir, images passed with `-i`;
  - the prompt on stdin;
  - the answer read from the `-o` file;
  - usage from the `--json` event stream if present, else zeros;
  - a concurrency semaphore (env `CODEX_CLI_CONCURRENCY`, default 2) and a
    timeout (300 s) that kills the process;
  - `_cli_env()`-style environment cleaning.
- A login or quota failure raises `StageError` carrying the classification,
  so 11a's chain marks `codex_cli` out.
- `AiImageAdapter._codex(...)` in `sources.py`: as above, written to
  `clips/<item id>.png`, gated as `provider="codex", operation="image.generate"`
  (price 0: subscription).
- Schema enums and the platform's `LLMS` list gain `codex_cli`; the `ai_image`
  provider list gains `codex`.

## Tests (faked subprocess: monkeypatch `subprocess.run` / `Popen` as the `claude_cli` tests do; find them with `grep -rn "_claude_cli\|claude_cli" worker/tests`)

- argv shape: stdin prompt, `-s read-only`, `-i` per image, no prompt text in argv.
- A "You've hit your usage limit… try again at 4:26 PM" stderr → classified
  quota, `StageError`, the ledger marks it out until 4:26 PM.
- "not logged in" → login, marked out 6 h.
- Image: a PNG left in the work folder is used; with none there, the one in a
  faked `generated_images/<thread>/` is; another thread's newer file is ignored.

## Real-call check (after the user has logged in)

One `chat("codex_cli", ...)` with a 20-word prompt, one `see(...)` with one
frame, one image ("a dark coal mining town street at dusk"). Look at the image.

## Docs

Next free D number; `docs/02-components/llm-usage.md` (providers); the plan's
slice 11 list; the user step (install and log in) in `docs/00-status.md`
under providers.
