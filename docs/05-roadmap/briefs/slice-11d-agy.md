# Slice 11d: agy, the Antigravity CLI (M)

Read [the briefs README](README.md) and
[11a](slice-11a-gemini-chains.md) first. It's the last provider brief, and the
most optional: 11a already reaches Gemini through the API key.

## Before anything: the user's step

`agy` is **not installed** on this machine. Stop and ask the user to install
the Antigravity CLI and log in (its OAuth session is the credential; the files
live under `~/.gemini/antigravity-cli/`). Only check that the credential file
**exists**. Never read, copy or print it.

This brief also needs the user's OK for one change **outside the repo**:
Dark Palace's `ensure_permissions()` adds `deny: command(*)` and
`allow: read_file(*), write_file(*)` to `~/.gemini/antigravity-cli/settings.json`,
so agy can never act as a coding agent that runs commands. Ask before writing
that file. If they say no, don't ship the image mode (text doesn't need it).

## Goal

A provider `agy` for text (and vision if the CLI supports image files the way
DP uses them), and an `ai_image` provider `agy` (Nano Banana through the CLI),
both chain-able (11a).

## Dark Palace sources (read-only)

`/home/thiago/darkpalace/DOCGERAL_STUDIO/motor/agy_esp.py` (952 lines).
Read the module docstring whole first. The parts that matter:
- **Transport.** On Windows, `agy -p` drops its stdout outside a terminal, so DP
  runs it inside a ConPTY (`winpty`, around line 193). **On Linux, use the
  standard library's `pty` module** (`pty.openpty()` + `subprocess.Popen(...,
  stdout=slave, stderr=slave)`, then read the master until the process exits
  or the deadline passes). First check whether the Linux build needs a
  terminal at all: run `agy -p "say ok"` with plain pipes. If the answer
  arrives, skip the pty.
- `_envelope` / `limpa`: the answer comes wrapped in an envelope; strip ANSI
  codes.
- A prompt over `LONG_PROMPT_CHARS` goes into `prompt.txt` in the work dir,
  and `-p` becomes "read prompt.txt" (an argv limit).
- `modelo()`: the model is `<base>-<low|medium|high>`. Make the base an env
  var `AGY_MODEL`.
- **Images:** `roda_gen` (line 835): `--dangerously-skip-permissions` is used
  **only** for image generation, with `--add-dir <out dir>`, never for text.
  `resgata` (line 697): if the PNG is not in the work dir, take it from agy's
  `brain` folder, only a file newer than the call and never one another call
  already took.
- **Quota:** image quota is a window (~60 images, then ~1 h 50 m closed).
  `fora_ate` / `marca_sem_cota_imagem`: mark `agy` out for images until the
  announced reset; text is never marked out. Use 11a's ledger with a key like
  `agy:image`. DP's `espera_janela()` sleeps until the window reopens; **don't
  port the waiting**. Let the chain move to the next image provider instead.

## How

Same shape as [11c](slice-11c-codex-cli.md): `_agy(...)` in `llm.py`, a
`PROVIDERS["agy"]` entry (no key, price 0), `AiImageAdapter._agy(...)` in
`sources.py`, schema enums and the platform `LLMS` list, a semaphore
(`AGY_CONCURRENCY`, default 1) and a timeout that kills the process tree.

## Tests

Fake the subprocess (as 11c does): argv for text has no
`--dangerously-skip-permissions`; image argv has it plus `--add-dir`; a long
prompt goes to `prompt.txt`; an image-quota message marks `agy:image` out and
leaves text usable; `resgata`-style recovery takes only a new, untaken file.

## Real-call check (after the user's step)

One text call and one image. Look at the image.

## Docs

Next free D number, including the settings.json change and the user's OK for
it; `docs/02-components/llm-usage.md`; the plan's slice 11 list, marking
slice 11 `✅ BUILT` once 11a–11d are in (Flow stays "not built", with the
reason).
