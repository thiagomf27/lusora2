# Cost Tracking — Draft v1

> Changing a price, a budget or a token ceiling? See
> [Tokens & Pricing](../08-tokens-and-pricing.md) — this file is the
> design; that one is where every number lives and what breaks.

Costs are architecture, not reporting. Two mechanisms:

## 1. cost_events with a lifecycle (adopted from OpenMontage)

Every paid or metered operation records events:

```
estimated → reserved → completed | failed → (refunded)
```

- Provider adapters are REQUIRED to emit them (it's part of the provider
  interface): LLM calls (tokens × price table), TTS (chars/seconds ×
  price), image/video generation (per-unit or credits returned by the
  API), stock (usually 0 — recorded anyway for rate visibility).
- The price table lives in config (`contracts/` data file), versioned;
  unknown provider+operation = hard error, not a silent $0. (OQ-15)
- `videos.price_usd` = SUM(completed) per video; channel and monthly
  aggregates are queries over the same table.

## 2. The budget gate

Before any generation step, the worker computes the video's
`spent + reserved + this_operation_estimate`. If it would exceed
`cfg.budget.max_usd_per_video`, the operation does NOT run: the video
stops with an actionable event ("beat b34: ai_image estimate $0.04 would
exceed budget $0.80; spent $0.79"). A human raises the budget, changes
the source policy, or edits the beat — then re-queues; the pipeline
resumes. Estimation before spending is the entire difference between a
budget and an alarm.

## Free-first defaults (why the numbers stay low)

Per-video AI spend in the default configuration: one beat-planner call +
repairs on a cheap model (~$0.01), script similar, TTS per narrated
minute, assets $0 while library/stock satisfy the policy. Orchestration
costs zero (code). The expensive paths — premium voices, image/video
generation, frontier models — are per-channel opt-ins, visible in the
same cost tables that justify them.
