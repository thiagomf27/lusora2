/**
 * Pipeline manifests (D60) — the stage list as data.
 *
 * One .yaml per name under contracts/pipelines, the same files the worker
 * loads. The platform's whole job here is SELECTION: pick a manifest at
 * enqueue and embed it in the cfg snapshot, so the worker never has to decide
 * (and never has to agree with a second copy of the rules).
 *
 * YAML because a human writes these by hand; JSON Schema validates the parsed
 * document either way, which is why there is no separate YAML schema.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ChannelConfig, PipelineCategory, PipelineManifest } from "@lusora/contracts";
import { repoRoot } from "./env.ts";
import { validateAgainst } from "./validate.ts";

/** The name is also the filename, so it must be a safe slug (schema pattern). */
export const PIPELINE_NAME_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * What a video with no pipeline named anywhere runs: the stage list every
 * video ran before manifests existed.
 */
export const DEFAULT_PIPELINE = "faceless";

export function pipelinesDir(): string {
  return join(repoRoot(), "contracts", "pipelines");
}

export function pipelinePath(name: string): string {
  if (!PIPELINE_NAME_RE.test(name)) throw new Error(`invalid pipeline name ${JSON.stringify(name)}`);
  return join(pipelinesDir(), `${name}.yaml`);
}

export function listPipelines(): string[] {
  const dir = pipelinesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""))
    .sort();
}

export type PipelineLoad =
  | { ok: true; manifest: PipelineManifest }
  | { ok: false; problem: string };

/** Parse + schema-validate one manifest. Never throws on bad data — the
 *  caller is an enqueue that must report problems, not a 500. */
export function loadPipeline(name: string): PipelineLoad {
  if (!PIPELINE_NAME_RE.test(name)) {
    return { ok: false, problem: `invalid pipeline name ${JSON.stringify(name)}` };
  }
  const path = pipelinePath(name);
  if (!existsSync(path)) {
    const known = listPipelines().join(", ") || "none";
    return { ok: false, problem: `pipeline '${name}' not found in contracts/pipelines (known: ${known})` };
  }
  let doc: unknown;
  try {
    doc = parseYaml(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, problem: `pipelines/${name}.yaml: not valid YAML: ${e instanceof Error ? e.message : e}` };
  }
  const res = validateAgainst("pipeline_manifest", doc);
  if (!res.ok) {
    return { ok: false, problem: `pipelines/${name}.yaml: ${res.errors.join("; ")}` };
  }
  const manifest = doc as PipelineManifest;
  if (manifest.name !== name) {
    return { ok: false, problem: `pipelines/${name}.yaml: 'name' is ${JSON.stringify(manifest.name)}, expected "${name}"` };
  }
  return { ok: true, manifest };
}

/**
 * One manifest reduced to what a picker (and the resolver) needs, without
 * making either read a stage list. A manifest that fails to parse still
 * appears, by name, carrying its `problem` — hiding a broken file is how a
 * channel ends up silently pointing at nothing.
 */
export interface PipelineSummary {
  name: string;
  category?: PipelineCategory;
  stability: "production" | "test";
  description?: string;
  bulk_production_accepted: boolean;
  stage_count: number;
  /** D62 — stage names this manifest stops after under review mode, in order.
   *  Summarised here so a picker can show where a run would wait without
   *  shipping the whole stage list to the client. */
  gates: string[];
  problem?: string;
}

export function listPipelineSummaries(): PipelineSummary[] {
  return listPipelines().map((name) => {
    const res = loadPipeline(name);
    if (!res.ok) {
      return { name, stability: "test" as const, bulk_production_accepted: false, stage_count: 0, gates: [], problem: res.problem };
    }
    const m = res.manifest;
    return {
      name,
      category: m.category,
      stability: m.stability ?? "test",
      description: m.description?.trim() || undefined,
      bulk_production_accepted: m.bulk_production_accepted !== false,
      stage_count: m.stages.length,
      gates: m.stages.filter((s) => s.human_approval_on_review_mode).map((s) => s.name),
    };
  });
}

export type PipelineSelection =
  | {
      ok: true;
      name: string;
      /** Why this one — carried into the enqueue event so a run explains itself. */
      reason: string;
    }
  | { ok: false; problem: string };

/**
 * THE selection resolver. One function, called once, at enqueue.
 *
 * Everything that could ever pick a pipeline (the video's format, the model
 * behind it, review mode, what the human uploaded) belongs here rather than
 * spread across routes, and the worker deliberately has no say: it walks the
 * manifest the snapshot names.
 *
 * The ladder, most specific first:
 *   1. `pipeline`          — a pinned manifest name, the escape hatch
 *   2. `production_style`  — the family; resolved to its shipped member (D61)
 *   3. the default         — `faceless`, what every video ran before either
 *                            field existed
 *
 * Adding a family (talking head, animation) is therefore a .yaml beside
 * faceless carrying `category: <style>`, and no code change here at all.
 */
export function selectPipeline(
  cfg: Pick<ChannelConfig, "pipeline" | "production_style">
): PipelineSelection {
  // 1. A pinned name wins over everything. This is the escape hatch that lets
  //    a channel run a `stability: test` variant of its own style without
  //    changing what the style means.
  if (cfg.pipeline) return { ok: true, name: cfg.pipeline, reason: "named in the config" };

  const style = cfg.production_style;
  if (!style) return { ok: true, name: DEFAULT_PIPELINE, reason: "default" };

  // 2. `custom` is the explicit "I pick the file myself" answer, so reaching
  //    here with nothing pinned is a contradiction worth saying out loud
  //    rather than quietly resolving to faceless.
  if (style === "custom") {
    return { ok: false, problem: "production_style is 'custom', which means the pipeline must be named explicitly — set `pipeline` on the channel or the video" };
  }

  // 3. Otherwise the style names a FAMILY and the resolver picks its shipped
  //    member: category matches, and test manifests are never picked by
  //    accident (they are opt-in by name, via rule 1).
  const shipped = listPipelineSummaries().filter((p) => !p.problem && p.stability === "production");
  const candidates = shipped.filter((p) => p.category === style);
  if (candidates.length === 0) {
    const known = shipped
      .map((p) => `${p.name} (${p.category ?? "no category"})`)
      .join(", ") || "none";
    return { ok: false, problem: `no production pipeline for production_style '${style}' (available: ${known}) — add contracts/pipelines/<name>.yaml with category: ${style}, or pin one with \`pipeline\`` };
  }
  // Deterministic tie-break: the manifest named after the style is the
  // family's default, otherwise the alphabetically first. Selection must give
  // the same answer twice or a re-enqueue is a different video.
  const exact = candidates.find((p) => p.name === style);
  const chosen = exact ?? candidates.slice().sort((a, b) => a.name.localeCompare(b.name))[0];
  const how = candidates.length === 1 ? "" : ` (of ${candidates.length} in that family)`;
  return { ok: true, name: chosen.name, reason: `production style '${style}'${how}` };
}

/**
 * Which artifacts a human may hand in for a given pipeline (D62).
 *
 * Manual-first was always true of EVERY stage — the orchestrator skips
 * whatever is already in the folder — so this is not a new capability, it is
 * the first time the capability is stated per pipeline instead of assumed for
 * all of them. A pipeline whose research must be generated to be trusted marks
 * that stage false and the upload is refused.
 *
 * Bootstrap inputs are not derivable from `produces` (nothing produces them),
 * so they are listed here: they are inputs to the FIRST stage that reads them,
 * not the output of any.
 */
export const BOOTSTRAP_UPLOADS = ["avatar.mp4"] as const;

export function receivableArtifacts(manifest: PipelineManifest): Set<string> {
  const allowed = new Set<string>(BOOTSTRAP_UPLOADS);
  for (const stage of manifest.stages) {
    if (!stage.receivable_on_upload) continue;
    for (const artifact of stage.produces ?? []) allowed.add(artifact);
  }
  return allowed;
}

/** A batch enqueue may only use pipelines that accept bulk production. */
export function bulkProductionProblem(manifest: PipelineManifest): string | null {
  if (manifest.stability === "test") {
    return `pipeline '${manifest.name}' is marked stability: test — run it one video at a time`;
  }
  if (manifest.bulk_production_accepted === false) {
    return `pipeline '${manifest.name}' does not accept bulk production`;
  }
  return null;
}
