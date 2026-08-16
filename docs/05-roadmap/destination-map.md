# Lusora — Destination Map (breadth-first pass)

The shallow map to decide **before** touching code. For each change: the goal,
the rough target shape, what it depends on, and whether it becomes YAML. Then a
recommended build order. Field-level detail is deliberately *not* here — that
gets decided when each slice is actually built (last responsible moment).

Write one decision-log entry (D60, D61, …) per change from this map before you
start that change.

---

## The two axes (why order matters)

Your five changes do not live on one line. They live on two independent axes,
and conflating them is what makes sequencing feel hard.

- **Orchestration axis** — how the worker walks the stages. One change:
  *pipelines-as-data*. The orchestrator only reads stage **names** and which
  **artifact** each produces; it never looks inside a beat, theme, or overlay.
  So this axis is **orthogonal** to everything creative and is safe to do first.

- **Creative-contract stack** — the data the AI and compiler consume. These are
  coupled and stack bottom-up:

  ```
  beats process            (consumes overlays + style-pack numbers)   ← top
  style packs / themes      (behavior numbers; appearance tokens)
  overlays / component catalog                                        ← bottom
  ```

  A beat references an overlay; a theme supplies the *element* for an overlay
  type; a style pack carries the pacing/density that shapes beats. Restructure
  the bottom before the top or you redesign the top twice.

UI simplification (removing overlay-creation + workflow controls) is downstream
of the overlay/theme decisions — do it once those shapes are final.

---

## The YAML decision — a split, not "everything"

Your instinct ("turn themes, style packs, etc. into readable YAML") is right for
**hand-authored config**, wrong for two categories. The real schemas decide this:

| Artifact | Authored by | Consumed by | Format | Why |
|---|---|---|---|---|
| Theme | human | engine only | **YAML** | config; comments + reuse help |
| Style pack | human | planner + compiler | **YAML** | config; pacing numbers read better with comments |
| Sound pack manifest | human | compiler | **YAML** | config |
| Pipeline manifest | human | orchestrator | **YAML** | config (this map's slice 1) |
| **Component catalog** | **generated** (`engine catalog` from Zod) | planner | **stay generated JSON** | not hand-authored — YAML-ifying a generated file is churn |
| Edit plan | machine | renderer | **stay JSON** | wire format; YAML buys nothing |
| Beat sheet | AI / human | compiler | **stay JSON** | wire format |

Rule of thumb: **YAML for what a human writes by hand, JSON for what a machine
emits or exchanges.** JSON is a subset of YAML, so a pure format change needs
**no schema rewrite** — the JSON Schema validates the parsed dict either way.
Watch YAML's footguns (the "Norway problem": `no`/`off`/`yes` parse as booleans;
whitespace significance). If you *also* restructure a schema for readability, do
the reformat and the restructure in the **same pass** so you don't edit every
file twice.

---

## The five changes

### 1. Pipelines-as-data  ·  orchestration axis  ·  **do first** — SHIPPED (D60)
**Goal:** stages become a selectable manifest, not a hardcoded `STAGES` list.
**Target shape:** `contracts/pipelines/*.yaml` (manifest) + a schema-validated
loader + a step **registry** (`name → (callable, done_check)`) + orchestrator
loops over the manifest's stages. Selection = one resolver `(format, model,
mode, uploads) → pipeline_name`.
**Depends on:** nothing creative. **Format:** YAML.
**Deferred (YAGNI):** `success_criteria` per stage (add when a validator exists
to read it); substages (faceless has none today — model the flat reality).
**Shipped:** schema, `faceless.yaml`, the loader, the registry, the resolver at
enqueue and the `pipeline_doc` snapshot. See [D60](../04-decisions/decided.md)
and [the contract page](../03-contracts/pipeline.md).

### 2. Overlays / component catalog  ·  bottom of creative stack  ·  **do second**
**Correction:** this is **not** a YAML/readability change. The catalog is
*generated* from the engine's Zod schemas and already has `when_to_use`,
`when_not_to_use`, `anchor_types`, `region`, `props`. The real change is a
**structural** one from your PDF: introduce a generic **`type_name`** (e.g.
`ChapterTitle`) that many themed elements can satisfy, so a beat asks for a
*type* and the theme supplies the concrete element.
**Target shape:** add `type_name` to the catalog entry; a theme maps
`type_name → concrete component`; define the **fallback rule** when a theme
doesn't provide a requested type (skip vs. default element — currently
undefined, this is the real gap).
**Depends on:** nothing above it. **Format:** stays generated JSON.

### 3. Themes  ·  middle of stack  ·  **do third (with 4)**
**Goal:** readable + provide the per-`type_name` element map from change 2.
**Target shape:** JSON → **YAML** for `contracts/themes/*`; add the
`type_name → element` mapping. Note these are engine-only appearance tokens
(colors, typography, motion_feel, grain, +surface/motion) — the AI never sees
them.
**Depends on:** overlay `type_name` vocabulary (change 2). **Format:** YAML.
**Touches OQ-10** (theme token list) — reconcile, don't reopen blindly.

### 4. Style packs  ·  middle of stack  ·  **do third (with 3)**
**Goal:** readable; house the pacing/density numbers your PDF's "doubts" ask for
(overlay priority, density counting, hold-by-type).
**Target shape:** JSON → **YAML** for `contracts/style-packs/*`. The pacing
fields already exist (`avg/min/max_hold`, `arc`, `hold_floor/ceiling_ratio`,
`overlays.density`); add **overlay priority** and **density-counting** rules
here as *data*, not prompt prose (Principle 3). **Format:** YAML.

### 5. Beats process  ·  top of stack  ·  **front half SHIPPED (D65)**
**Goal:** make the internal phases explicit/modular (your PDF: spine →
script_split → srt_alignment → beat_parts → chunking → beat_writing). Some
already exist inside `run_plan_beats` (the D52 two-phase spine/chunk).
**Target shape:** either substages in the pipeline manifest (change 1 gives you
the slot) or a documented sub-registry inside the beats step; a schema for the
**running visual ledger** (currently behavior-only, no contract).
**Depends on:** overlays (catalog `when_to_use`) + style pack (pacing/density) —
which is exactly why it's last.
**Shipped (D65):** the phases that depend on NEITHER — `script_split`,
`srt_alignment`, `beat_parts` — are real code in
`worker/lusora_worker/beatphases.py`, declared as substages on `plan_beats` in
`faceless_v2` and checked at load against a worker sub-registry. Beat
boundaries now follow the style pack's hold floor and the real transcript.
**Still waiting:** the VISUAL half (what a beat shows) — that is the part that
needs `type_name` and the overlay priority/density numbers. The visual-ledger
schema is deliberately not built: the ledger is a prompt fragment, not a shape
crossing two parts.

---

## Recommended slice order

Each slice is a **vertical slice** that still produces a video end-to-end. Your
"manual-first / skip what exists" design keeps the pipeline runnable at every
step: hand-provide any artifact you haven't rebuilt yet.

1. **Pipelines-as-data.** Decoupled, low-risk, unlocks the modularity you most
   want, and forces clean stage names that clarify everything downstream.
   *(Shipped — D60.)*
2. **Overlays `type_name` + theme fallback rule.** Bottom of the stack; defines
   the vocabulary the rest depends on. (Structural, not YAML.)
3. **Themes + style packs → YAML**, carrying the `type_name` element map (themes)
   and the priority/density/hold numbers (style packs). One pass each: reformat
   and restructure together.
4. **Beats process** restructure, against the now-stable overlay + style-pack
   shapes. Add the visual-ledger schema.
5. **UI simplification** last: delete overlay-creation and workflow controls
   against the final backend shapes.

---

## Working rules (carry these through every slice)

- **Contracts before code (Principle 2):** any shape crossing two parts is a
  schema in `contracts/` first. A schema change + its consumers land in one
  commit.
- **One decision-log entry per slice, before you start it.** A few paragraphs
  stating the target shape + what it depends on. This is what makes the
  breadth-first pass cheap.
- **Done-checks stay in code, not the manifest.** Whether a stage is "done" by
  artifact-presence or freshness is *mechanism*; the manifest declares only
  *what* runs and *what it produces* (policy). Keep the leak out.
- **`requires` is advisory in slice 1.** The orchestrator still runs stages in
  manifest order; `requires` is declared now so the loader can validate the DAG
  and future selection logic has the data.
- **Naming hygiene:** the repo-structure doc still says `videofarm/`; the name is
  `lusora` (OQ-1). Sweep drift when you touch a file — the AI reads these names.
- **Terminology:** you have *themes* (engine appearance) AND *style packs*
  (planner behavior) — the PDF sometimes conflates them. Keep them distinct in
  every doc.
