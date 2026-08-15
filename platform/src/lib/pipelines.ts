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
import type { ChannelConfig, PipelineManifest } from "@lusora/contracts";
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

export interface PipelineSelection {
  name: string;
  /** Why this one — carried into the enqueue event so a run explains itself. */
  reason: string;
}

/**
 * THE selection resolver. One function, called once, at enqueue.
 *
 * Everything that could ever pick a pipeline (the video's format, the model
 * behind it, review mode, what the human uploaded) belongs here rather than
 * spread across routes, and the worker deliberately has no say: it walks the
 * manifest the snapshot names. Today exactly one rule fires, because exactly
 * one pipeline exists — a config that names a pipeline gets that pipeline,
 * anything else gets the default. New families (talking head, shorts) add a
 * rule here and a .yaml beside faceless, and touch no other code.
 */
export function selectPipeline(cfg: Pick<ChannelConfig, "pipeline">): PipelineSelection {
  if (cfg.pipeline) return { name: cfg.pipeline, reason: "named in the config" };
  return { name: DEFAULT_PIPELINE, reason: "default" };
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
