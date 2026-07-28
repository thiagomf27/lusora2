/**
 * Plan patch operations (editor + chat agent). Custom validated ops, not
 * raw JSON-patch: every op is checked, applied to a copy, and the result
 * is schema + structurally validated before it is written. Any manual
 * change to timing/asset/transform sets `locked` (OQ-19); volume tweaks
 * do not.
 */
import type { EditPlan } from "@lusora/contracts";
import { validateAgainst } from "./validate";

export type PlanOp =
  | { op: "set_timing"; id: string; start_s?: number; end_s?: number; in_offset_s?: number }
  | { op: "set_transform"; id: string; scale?: number; position?: "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center" }
  | { op: "move_overlay"; id: string; start_s: number; end_s: number }
  | { op: "set_music_volume"; index?: number; id?: string; volume: number }
  | { op: "move_sfx"; id: string; start_s: number; end_s?: number }
  | { op: "set_sfx_gain"; id: string; gain: number }
  | { op: "remove_sfx"; id: string }
  | { op: "remove_overlay"; id: string }
  | { op: "set_lock"; id: string; locked: boolean };

export interface ApplyResult {
  ok: boolean;
  errors: string[];
  plan?: EditPlan;
  touched: string[];
}

export function applyPlanOps(plan: EditPlan, ops: PlanOp[]): ApplyResult {
  const next: EditPlan = structuredClone(plan);
  const errors: string[] = [];
  const touched: string[] = [];

  const findVisual = (id: string) => next.tracks.visual.find((i) => i.id === id);
  const findOverlay = (id: string) => next.tracks.overlays.find((i) => i.id === id);

  for (const op of ops) {
    switch (op.op) {
      case "set_timing": {
        const visual = findVisual(op.id);
        const item = visual ?? findOverlay(op.id);
        if (!item) {
          errors.push(`set_timing: item ${op.id} not found`);
          break;
        }
        if (op.start_s !== undefined) item.start_s = op.start_s;
        if (op.end_s !== undefined) item.end_s = op.end_s;
        if (op.in_offset_s !== undefined) {
          if (visual) visual.in_offset_s = op.in_offset_s;
          else errors.push(`set_timing: in_offset_s only applies to visual items (${op.id})`);
        }
        item.locked = true;
        touched.push(op.id);
        break;
      }
      case "set_transform": {
        const item = findOverlay(op.id);
        if (!item || item.kind !== "media") {
          errors.push(`set_transform: media overlay ${op.id} not found`);
          break;
        }
        item.transform = { ...item.transform };
        if (op.scale !== undefined) item.transform.scale = op.scale;
        if (op.position !== undefined) item.transform.position = op.position;
        item.locked = true;
        touched.push(op.id);
        break;
      }
      case "move_overlay": {
        const item = findOverlay(op.id);
        if (!item) {
          errors.push(`move_overlay: overlay ${op.id} not found`);
          break;
        }
        item.start_s = op.start_s;
        item.end_s = op.end_s;
        item.locked = true;
        touched.push(op.id);
        break;
      }
      case "remove_overlay": {
        const idx = next.tracks.overlays.findIndex((i) => i.id === op.id);
        if (idx < 0) {
          errors.push(`remove_overlay: overlay ${op.id} not found`);
          break;
        }
        next.tracks.overlays.splice(idx, 1);
        touched.push(op.id);
        break;
      }
      case "set_lock": {
        const item = findVisual(op.id) ?? findOverlay(op.id);
        if (!item) {
          errors.push(`set_lock: item ${op.id} not found`);
          break;
        }
        item.locked = op.locked;
        touched.push(op.id);
        break;
      }
      case "set_music_volume": {
        // Music items gained ids in D48, but the welded chat vocabulary and any
        // saved op log still address them by index. Both forms stay valid.
        const music = next.tracks.audio.music ?? [];
        const m = op.id !== undefined ? music.find((i) => i.id === op.id) : music[op.index ?? -1];
        if (!m) {
          errors.push(`set_music_volume: music ${op.id ?? `[${op.index}]`} not found`);
          break;
        }
        m.volume = op.volume; // volume tweaks do NOT lock (OQ-19)
        break;
      }
      case "move_sfx": {
        const s = next.tracks.audio.sfx?.find((i) => i.id === op.id);
        if (!s) {
          errors.push(`move_sfx: sfx ${op.id} not found`);
          break;
        }
        // keep the cue's own length unless an end is given: a cue is a sound of
        // a fixed duration, so dragging it should move it, not stretch it
        const length = s.end_s - s.start_s;
        s.start_s = op.start_s;
        s.end_s = op.end_s ?? op.start_s + length;
        s.locked = true; // a timing edit locks (OQ-19)
        touched.push(op.id);
        break;
      }
      case "set_sfx_gain": {
        const s = next.tracks.audio.sfx?.find((i) => i.id === op.id);
        if (!s) {
          errors.push(`set_sfx_gain: sfx ${op.id} not found`);
          break;
        }
        s.gain = op.gain; // a level tweak does NOT lock, same rule as music
        break;
      }
      case "remove_sfx": {
        const idx = next.tracks.audio.sfx?.findIndex((i) => i.id === op.id) ?? -1;
        if (idx < 0) {
          errors.push(`remove_sfx: sfx ${op.id} not found`);
          break;
        }
        next.tracks.audio.sfx!.splice(idx, 1);
        touched.push(op.id);
        break;
      }
      default:
        errors.push(`unknown op ${(op as { op: string }).op}`);
    }
  }
  if (errors.length) return { ok: false, errors, touched };

  const structural = validatePlanStructure(next);
  const schema = validateAgainst("edit_plan", next);
  const all = [...schema.errors, ...structural];
  if (all.length) return { ok: false, errors: all, touched };
  return { ok: true, errors: [], plan: next, touched };
}

/** Light structural checks (the worker's full validator re-runs at render). */
export function validatePlanStructure(plan: EditPlan): string[] {
  const errors: string[] = [];
  const visual = plan.tracks.visual;
  if (visual.length && Math.abs(visual[0].start_s) > 1e-6) {
    errors.push("visual track must start at 0");
  }
  for (let i = 0; i < visual.length; i++) {
    if (visual[i].end_s <= visual[i].start_s) errors.push(`visual ${visual[i].id}: non-positive duration`);
    if (i > 0 && Math.abs(visual[i - 1].end_s - visual[i].start_s) > 1e-3) {
      errors.push(`visual ${visual[i - 1].id} → ${visual[i].id}: not contiguous`);
    }
  }
  const vo = plan.tracks.audio.voiceover;
  const total = (vo.start_s ?? 0) + vo.duration_s;
  for (const o of plan.tracks.overlays) {
    if (o.end_s <= o.start_s) errors.push(`overlay ${o.id}: non-positive duration`);
    if (o.end_s > total + 0.75) errors.push(`overlay ${o.id}: ends after the video`);
  }
  return errors;
}
