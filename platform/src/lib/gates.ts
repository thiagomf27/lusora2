/**
 * Review gates (D62) and requested gates (D105), from a video's cfg snapshot
 * and its folder only — no database, so a test can load this module.
 *
 * A review gate is declared by the manifest and is live when the video runs in
 * review mode (`guided`). A requested gate is raised by a stage about its own
 * output — thin footage — and is live on any video. Either is passed by the
 * same file: approvals/<stage>.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PipelineManifest } from "@lusora/contracts";
import { videoFolder } from "./folders.ts";

/** What gate logic needs of a video row. */
export interface GateVideo {
  id: string;
  cfg: unknown;
}


/** Where an approval lives. The folder is the data plane of record, so a
 *  passed gate is a FILE — the worker's resume ("skip what exists") then
 *  covers checkpoints for free, and an approval survives a worker restart. */
export function approvalPath(videoId: string, stage: string): string {
  return join(videoFolder(videoId), "approvals", `${stage}.json`);
}

/** The stages a video's OWN pipeline snapshot would stop after. Read from
 *  `pipeline_doc`, never from the manifest on disk: editing faceless.yaml must
 *  not move the gates of a video already in flight (Principle 7). */
export function gatedStages(video: GateVideo): string[] {
  const doc = (video.cfg as { pipeline_doc?: PipelineManifest } | null)?.pipeline_doc;
  return (doc?.stages ?? [])
    .filter((s) => s.human_approval_on_review_mode || existsSync(requestPath(video.id, s.name)))
    .map((s) => s.name);
}

/** D105: a stage that asked for a human about its own output (thin footage)
 *  writes this file; the worker stops there on ANY video, auto or guided. */
export function requestPath(videoId: string, stage: string): string {
  return join(videoFolder(videoId), "gate_requests", `${stage}.json`);
}

/** The reason a stage gave for asking, or null (a review-mode gate gives none). */
export function gateReason(video: GateVideo, stage: string): string | null {
  try {
    const doc = JSON.parse(readFileSync(requestPath(video.id, stage), "utf8")) as { reason?: string };
    return doc.reason ?? null;
  } catch {
    return null;
  }
}

function reviewMode(video: GateVideo): boolean {
  const cfg = video.cfg as { checkpoint_policy?: string; pipeline_doc?: { default_checkpoint_policy?: string } } | null;
  return (cfg?.checkpoint_policy ?? cfg?.pipeline_doc?.default_checkpoint_policy ?? "auto") === "guided";
}

/**
 * The gate this video is actually stopped at: the first LIVE gate with no
 * approval file yet — a declared one when the video runs in review mode, or
 * one a stage requested (D105). The worker walks stages in order and stops at
 * the first unapproved live gate, so "first without a file" is the same answer
 * it reached — derived from the folder rather than tracked in a column.
 */
export function pendingGate(video: GateVideo): string | null {
  const doc = (video.cfg as { pipeline_doc?: PipelineManifest } | null)?.pipeline_doc;
  const guided = reviewMode(video);
  for (const s of doc?.stages ?? []) {
    const live = (guided && s.human_approval_on_review_mode) || existsSync(requestPath(video.id, s.name));
    if (live && !existsSync(approvalPath(video.id, s.name))) return s.name;
  }
  return null;
}
