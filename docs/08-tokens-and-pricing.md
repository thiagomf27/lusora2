# Tokens & Pricing — the operator's guide

Every number that decides how much a video costs, where it lives, and
what happens when you change it. This is the "I want to turn a knob"
doc; [Cost Tracking](03-contracts/costs.md) is the design contract
behind it and [LLM Usage](02-components/llm-usage.md) is the map of the
prompts themselves.

There are three independent systems here, and confusing them is the
usual source of trouble:

| System | Question it answers | Lives in |
| --- | --- | --- |
| **Token budgets** (`max_tokens`) | how much room the model gets to answer | code defaults + prompt packs |
| **Price table** | what a token/char/image costs | `contracts/prices.json` |
| **Budget gate** | may this operation run at all | `channel.budget.max_usd_per_video` |

A token budget is a *ceiling*, not a bill. Unused budget is free —
providers charge for tokens actually produced. Raising `max_tokens`
does not raise your cost; it only removes a truncation failure mode.
That asymmetry is why every number below errs high.

---

## 1. Token budgets

### Where each number comes from

Every LLM caller resolves its budget the same way: **prompt pack
`max_tokens` if set, otherwise the code default.**

| Caller | Code default | File |
| --- | --- | --- |
| Script agent | **8000** | [script.py:64](../worker/lusora_worker/agents/script.py#L64) |
| Beat planner | **64000** | [planner.py:187](../worker/lusora_worker/agents/planner.py#L187) |
| Editor chat (platform) | **12000** | [chatAgent.ts:53](../platform/src/lib/chatAgent.ts#L53) |
| Prompt "Test run" (platform) | **4000** | [preview/route.ts:170](../platform/src/app/api/prompts/preview/route.ts#L170) |
| `llm.chat()` signature fallback | 4000 (never used — every caller passes one) | [llm.py:43](../worker/lusora_worker/providers/llm.py#L43) |

### How to change one

**Per prompt pack (preferred — no code change, no redeploy):** add
`max_tokens` to the pack JSON in `contracts/prompts/<role>/<name>.json`.
Schema: integer, minimum 256, `null` = "use the code default"
([prompt.schema.json](../contracts/schemas/prompt.schema.json)).

```json
{
  "name": "doc-grave",
  "role": "script",
  "max_tokens": 20000,
  "system": "…"
}
```

**Globally:** edit the code default in the table above. That changes the
floor for every pack that does not set its own.

⚠️ The pack's value is snapshotted into the video's cfg **at enqueue
time** (D44). Editing a pack does not change videos already in the
queue — re-queue them to pick it up.

### Why the planner's number is so much larger

`deepseek-v4-*` are reasoning models and **reasoning tokens are billed
out of `max_tokens`, before the answer starts.** A budget that only fits
the answer produces `finish_reason: "length"`, truncated mid-JSON.

Measured on the real planner prompt: reasoning ran 4.2k–9.3k tokens on
early runs, then **15.8k on a single run on 2026-07-28** — the spread is
wide and is *not* bounded by prompt size. That run truncated against the
old 16k ceiling, which is why the default is now 64000 (verified
accepted by the API for `deepseek-v4-*`).

Reasoning **cannot be turned off**. `reasoning_effort` accepts only
`high|low|medium|max|xhigh`, and in an A/B on the real prompt `low` used
*more* reasoning than the default (7215 vs 4216). Headroom is the only
reliable lever.

**Symptom to recognize:** a `StageError` from the `llm` stage reading
`hit the N-token ceiling before finishing (… of them reasoning)`. That
check is in [llm.py:82-91](../worker/lusora_worker/providers/llm.py#L82-L91)
and exists because without it the caller only sees unparseable output and
misreports it as "the model returned no JSON object".

**Still exposed:** the script agent (8000) and editor chat (12000) sit
below that 15.8k observed reasoning spike. Different prompts, so they
may never hit it — but if either starts failing with truncation, raise
it first and look for other causes second.

---

## 2. The price table

[`contracts/prices.json`](../contracts/prices.json) — keyed
`provider → operation → {unit, unit_price_usd}`.

```json
"deepseek": {
  "llm.plan_beats": { "unit": "token", "unit_price_usd": 0.00000028 }
}
```

Rules:

- **An unknown provider+operation is a hard error, never a silent $0**
  ([costs.py:19-28](../worker/lusora_worker/costs.py#L19-L28), OQ-15).
  Wiring a new provider means adding its prices *before* it can spend.
- `unit` is documentation for you; the code multiplies
  `units × unit_price_usd` and never reads it. Get the unit right in
  your head: tokens for LLMs, **characters** for TTS, images for
  generation.
- LLM rates are a **single blended per-token price** — input and output
  are not priced separately. For providers that charge more for output
  (all of them), pick a rate near the output price or you will
  under-report.

Operations currently priced: `llm.generate_script`, `llm.plan_beats`,
`llm.chat_edit`, `tts.narrate`, `whisper.transcribe`, `image.generate`,
`stock.search`, `stock.download`.

⚠️ **The DeepSeek rate is stale.** `0.00000028/token` ($0.28/M) predates
the v4 migration and was set as a placeholder (OQ-15). Since v4 also
burns 3x the tokens per plan, reported per-video LLM cost is currently
an underestimate on both factors. Check the vendor's current page and
update the three `deepseek.*` entries together.

---

## 3. The budget gate

Set per channel: `budget.max_usd_per_video`, default **$0.80**
([fixtures/channel_config.json:15](../contracts/fixtures/channel_config.json#L15)).

- **UI:** Channel settings form → budget field
  ([ChannelConfigForm.tsx:340](../platform/src/components/ChannelConfigForm.tsx#L340))
- **Per video:** the Queue screen's overrides JSON —
  `{"budget": {"max_usd_per_video": 2}}`

Before each paid operation the worker computes
`spent + reserved + this_estimate`; if that exceeds the budget the
operation does **not** run and the video stops with an actionable event.
Estimating before spending is the whole difference between a budget and
an alarm.

### The estimates that feed the gate

The gate reserves against a hardcoded *estimate*, then reconciles with
actuals after the call:

| Operation | Estimated units | Where |
| --- | --- | --- |
| `llm.generate_script` | 1200 tokens | [script.py:66](../worker/lusora_worker/agents/script.py#L66) |
| `llm.plan_beats` | 12000 tokens **per attempt** (≤3) | [planner.py:201](../worker/lusora_worker/agents/planner.py#L201) |
| `tts.narrate` | `len(script)` chars — exact | [tts.py:53](../worker/lusora_worker/providers/tts.py#L53) |
| `image.generate` | 1 image | [sources.py:247](../worker/lusora_worker/providers/sources.py#L247) |

⚠️ The planner's 12000 is now a systematic **under**-reservation: with a
64k ceiling a single call can bill more than that. It self-corrects
(actuals are written after every call, and the next gate sees them), so
it under-reserves rather than over-spends. Raising it makes the gate
stricter — a decision about your ceiling, not a bug fix.

### The event lifecycle

```
estimated → reserved → completed | failed → (refunded)
```

Valid statuses are fixed in **both** the contract
([cost_event.schema.json](../contracts/schemas/cost_event.schema.json))
and the Postgres enum `cost_status`
([0001_init.sql:9](../contracts/db/0001_init.sql#L9)). Anything else is
rejected by the database.

Aggregation reads only some of them, which matters when you add a
writer:

- `spent_and_reserved()` (the gate) sums **`completed` + `reserved`**
- the channel costs API sums **`completed`** only
- `videos.price_usd` is the denormalized sum of `completed`

🐛 **Known bug:** the prompt "Test run" endpoint inserts
`status = 'actual'`
([preview/route.ts:180](../platform/src/app/api/prompts/preview/route.ts#L180)),
which is not in the `cost_status` enum — that INSERT fails in Postgres,
so a test run errors after the model has already been paid for. Use
`'completed'`. (Its 4000-token default is also too low for a planner
preview under a reasoning model, so those previews truncate.)

---

## 4. Model selection

Resolution order, most specific first:

1. **Channel config** — `script.model`, `planner.model`, `chat.model`
2. **Prompt pack** `model_hint` (advisory; channel config always wins)
3. **Provider default** in
   [`PROVIDERS`](../worker/lusora_worker/providers/llm.py#L21)

| Provider | Default model | Env var | Base URL |
| --- | --- | --- | --- |
| `deepseek` | `deepseek-v4-pro` | `DEEPSEEK_API_KEY` | api.deepseek.com/v1 |
| `openai` | `gpt-4o-mini` | `OPENAI_API_KEY` | api.openai.com/v1 |
| `anthropic` | `claude-haiku-4-5-20251001` | `ANTHROPIC_API_KEY` | api.anthropic.com/v1 |
| `mock` | — | none | deterministic fallback, $0 |

Which provider runs is `channel.script.llm` / `channel.planner.llm`
(default `deepseek`). The editor chat is not channel-routed the same
way: it uses DeepSeek if `DEEPSEEK_API_KEY` is set and falls back to
Anthropic otherwise.

**A missing API key is an actionable error, not a crash** — it names the
env var and tells you to switch the channel to `mock`. `mock` is priced
at $0 for every operation and is the way to exercise the pipeline
without spending.

---

## 5. Cheat sheet — "I want to…"

| Goal | Do this |
| --- | --- |
| Stop truncation on one prompt | add `max_tokens` to that prompt pack, re-queue |
| Stop truncation everywhere | raise the code default in §1 |
| Make a channel cheaper | lower `budget.max_usd_per_video`; switch `planner.llm`/`script.llm` to a cheaper provider; keep image generation off in the source policy |
| Let one expensive video through | Queue overrides: `{"budget": {"max_usd_per_video": 2}}` |
| Add a provider | add its `PROVIDERS` row **and** its prices in `prices.json` — the gate hard-errors without them |
| Fix wrong reported costs | update `unit_price_usd` in `prices.json` (per-token blended, output-weighted) |
| Run the whole pipeline for free | set the channel's `llm` and `voice.provider` to `mock` |
| See what a video actually cost | `videos.price_usd`, or the channel costs API / Monitoring screen |

---

## 6. Open items

- **OQ-15** — every price is a placeholder until real providers are
  settled; the DeepSeek rate specifically predates v4 (§2).
- The planner's gate estimate lags its real budget (§3).
- The `'actual'` status bug in the prompt preview route (§3).
- Script (8000) and editor chat (12000) budgets are below the observed
  reasoning spike (§1).
