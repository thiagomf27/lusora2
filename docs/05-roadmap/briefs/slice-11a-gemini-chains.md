# Slice 11a: Gemini, fallback chains and the quota ledger (M)

Read [the briefs README](README.md) first. This is the base the other slice 11
briefs build on.

## Goal

1. A new LLM provider `gemini` (Google's Gemini API with the key already in
   `.env` as `GEMINI_API_KEY`), for text and vision.
2. **Fallback chains.** Wherever a channel names an LLM provider, it may name
   a list instead: `["claude_cli", "gemini", "deepseek"]`. The first provider
   that is ready answers. If it fails (down, out of quota, logged out), the same
   call goes to the next one at once.
3. **A quota ledger.** A provider that fails for quota or login is marked out
   until the time it reported (or a default), in one file shared by every
   video, so later calls skip it instead of failing again.

A plain string still works exactly as today: every existing channel config and
plan must behave identically.

## Dark Palace sources (read-only)

- `/home/thiago/darkpalace/DOCGERAL_STUDIO/motor/llm.py`, lines 1–140: the
  queues per kind of task (`fila`), `_marca_fora` (out until the reported
  time, 6 h when none), `porque_fora`, `_depois_da_falha`.
- `/home/thiago/darkpalace/DOCGERAL_STUDIO/motor/gemini_esp.py`:
  - the REST calls (`_post`, `_chama`, `ask_text`, `ask_vision`);
  - `modelos` / `candidatos` / `escolhe_modelo`: the key's own model list, the
    best one that still has quota;
  - `_espera_do_429`: wait for `RetryInfo.retryDelay` or `Retry-After`;
  - `_e_cota_do_dia`: a 429 that is the **daily** quota (or `limit: 0`, a
    model the free tier doesn't have) means "out until tomorrow", not "wait
    20 s".

## Where it goes in LUSORA

All in `worker/lusora_worker/providers/llm.py` (read it whole first; it's 376
lines) plus a new `worker/lusora_worker/providers/quota.py`.

**1. The `gemini` provider.** Add `PROVIDERS["gemini"]` with a new kind
`"gemini"`, `env_var="GEMINI_API_KEY"`, `vision=True`, `max_temperature=2.0`.
Implement it in `chat()` and `see()`:
- `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
  with the key in the `x-goog-api-key` header (never in the URL, so it can't
  leak into a log);
- the system text goes in `systemInstruction`;
- images go as `inlineData` parts;
- `expect_json` sets `generationConfig.responseMimeType = "application/json"`;
- token usage comes from `usageMetadata` (`promptTokenCount`,
  `candidatesTokenCount`).

Default model: env `GEMINI_MODEL`, else `"gemini-2.5-flash"`. Before coding,
list the key's models once (`GET /v1beta/models`, key in the header, print
names only) and pick the newest Flash model it offers. Use that as the default
and note it in the decision entry. That listing is free.

**2. Chains.** A provider argument may be a `str` or a `list[str]`. Each
element is `"provider"` or `"provider/model"` (for example
`"claude_cli/sonnet"`, `"gemini/gemini-2.5-flash"`). The channel's separate
`model` field keeps applying only when `llm` is a plain string.
- Add `def chain_of(value, default) -> list[str]` to `llm.py`. It turns
  `None`, a `str` or a `list` into a list of elements.
- `chat()` and `see()` accept either form. For a list: skip elements the ledger
  marks out, then try each in turn. A `StageError` from one element moves to
  the next. When every element fails, raise one `StageError` naming each
  element and why it failed.
- Put the answering provider on the result: add `provider: str = ""` and
  `model: str = ""` to `LLMResult`, so callers can record who answered.
- **Callers.** 13 sites read a provider with `str(x.get("llm") or ...)`, which
  would turn a list into the text `"['a', 'b']"`. Find them with
  `grep -rn 'get("llm")' worker/lusora_worker --include=*.py`, plus
  `agents/pick_shots.py` (`conf["llm"]`). Change each one to keep the value
  as it is, and to test for mock with `chain_of(...) == ["mock"]`.
- **The budget gate** (`worker/lusora_worker/costs.py`, `budget_gate`) takes
  one provider name for its estimate. For a chain, pass the first element the
  ledger does not mark out (add `llm.gate_provider(chain)`). Write the element
  that actually answered into the cost event's `details` as `answered_by`.
  Read how the sites call `cost.actual(...)` and keep that.

**3. The ledger** (`providers/quota.py`):
- One JSON file: `<videos_root>/../llm_quota.json`. Find how `sources.py`
  locates `stock-cache` next to `videos_root` (`ctx.config.videos_root.parent`),
  and fall back to a path in the repo's `data/` when there is no config
  (tests).
- Shape: `{"<provider>": {"out_until": <unix time>, "reason": "..."}}`.
- Write through a temporary file and `os.replace`, under a `threading.Lock`.
  Several worker threads write it.
- `mark_out(provider, reason, seconds)` and `out_reason(provider) -> str`.
  An empty string means the provider may be tried.
- **Classifying a failure** (`classify(provider, error_text, http_status)`):
  - HTTP 429 or text with "quota", "rate limit" or "usage limit" → out;
  - HTTP 401/403 or "not logged in", "login", "unauthorized" → out;
  - a network error or a 5xx → **not** marked out (weather, not quota; the
    chain still moves on for this call);
  - duration: a reset time found in the text ("try again at 4:26 PM",
    "resets in 3h", `retryDelay: "21s"`), else DP's defaults: Gemini's daily
    quota until the next midnight Pacific time; anything else 6 h.
- Report every mark through `ctx.db.provider_health(f"llm.{provider}", False, reason)`
  where a context is at hand. `chat()` has no context: return the mark in the
  exception, and let the callers that do have one report it.

**4. Schema and types.** In `contracts/schemas/channel_config.schema.json`,
every `"llm": {"type": "string"}` (4 places; the `pick` one around line 399
may be an enum, so keep its values) becomes
`{"oneOf": [<the old string rule>, {"type": "array", "items": <the old string rule>, "minItems": 1}]}`.
Chain elements with a `/model` suffix must pass too, so the element pattern
needs to allow `provider/model`. In `contracts/src/types.ts`, the matching
fields become `string | string[]`.

**5. Prices.** `contracts/prices.json` needs `gemini` entries for every
`llm.*` operation that other providers have (copy the operation list from the
`deepseek` block). **Stop and ask the user** whether their Gemini key is on
the free tier (price 0, tokens still recorded, as `claude_cli` is) or paid
(use Google's current per-token prices for the default model).

**6. Platform.** `platform/src/components/ChannelConfigForm.tsx` has LLM
selects (`LLMS`). Add `gemini` to that list. When a saved value is an array,
show it as a text input of comma-separated elements instead of the select, so
opening and saving the form never flattens a chain. Keep it that simple.

## Tests (`worker/tests/test_llm_chain.py`)

Fake the network with monkeypatch, as `tests/test_tts.py` fakes `httpx`:
- `gemini` text: request shape (key in the header, system instruction, JSON
  mime type when asked), token usage read back.
- `gemini` vision: an image becomes an `inlineData` part.
- A chain whose first element raises a quota error: the second answers,
  `result.provider` names it, the ledger marks the first out, and a second call
  does not try the first at all.
- A 5xx on the first element: the chain moves on, but the first is **not**
  marked out.
- Every element fails → one `StageError` naming them all.
- `chain_of`: `None` → default, `"a"` → `["a"]`, a list stays a list.
- A plain-string config compiles, plans and calls exactly as before (run the
  existing suite: it must stay green without edits to old tests).
- The ledger survives two threads marking at once (valid JSON afterwards).
- Reset parsing: "resets in 3h", "try again at 4:26 PM", `"retryDelay": "21s"`.

## Real-call check (allowed, tiny)

One real `chat("gemini", ...)` with a 20-word prompt and one `see(...)` with
one small JPEG from `data/videos/vid_dfd49c6c34e4/` (any frame; extract one
with ffmpeg). Print only the answer and the token counts.

## Benchmark

Not needed: nothing about the picture changes. If the user asks for one, fork
`vid_dfd49c6c34e4` with `planner.llm` set to `["gemini", "deepseek"]`.

## Docs

- Next free D number: the chain grammar, the ledger file and its rules, the
  Gemini default model, and that a plain string is unchanged.
- `docs/02-components/llm-usage.md`: a short "Providers and chains" section.
- `docs/08-tokens-and-pricing.md`: the Gemini price entries and what `answered_by` is.
- The plan: under slice 11, list 11a as built.
