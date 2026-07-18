/**
 * Beat operations (beat editor + chat agent): semantic edits over
 * beats.json. Split/merge only at existing sentence boundaries so script
 * coverage stays verbatim by construction.
 */
import type { BeatSheet, Beat, BeatOverlay } from "@lusora/contracts";

export type BeatOp =
  | { op: "set_visual_intent"; beat_id: string; visual_intent: string }
  | { op: "set_mood"; beat_id: string; mood: string }
  | { op: "set_media_preference"; beat_id: string; media_preference: "video" | "image" | "any" }
  | { op: "set_overlay"; beat_id: string; overlay: BeatOverlay | null }
  | { op: "split_beat"; beat_id: string; after_sentence: number }
  | { op: "merge_with_next"; beat_id: string };

export interface BeatApplyResult {
  ok: boolean;
  errors: string[];
  beats?: BeatSheet;
  touched: string[];
}

const SENTENCE_END = /(?<=[.!?…])\s+/;

export function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(SENTENCE_END).filter(Boolean);
}

export function applyBeatOps(sheet: BeatSheet, ops: BeatOp[]): BeatApplyResult {
  const next: BeatSheet = structuredClone(sheet);
  const errors: string[] = [];
  const touched: string[] = [];

  const find = (id: string): [number, Beat] | null => {
    const idx = next.beats.findIndex((b) => b.id === id);
    return idx < 0 ? null : [idx, next.beats[idx]];
  };

  for (const op of ops) {
    const found = find(op.beat_id);
    if (!found) {
      errors.push(`${op.op}: beat ${op.beat_id} not found`);
      continue;
    }
    const [idx, beat] = found;
    switch (op.op) {
      case "set_visual_intent":
        beat.visual_intent = op.visual_intent;
        touched.push(beat.id);
        break;
      case "set_mood":
        beat.mood = op.mood;
        touched.push(beat.id);
        break;
      case "set_media_preference":
        beat.media_preference = op.media_preference;
        touched.push(beat.id);
        break;
      case "set_overlay":
        if (op.overlay === null) delete beat.overlay;
        else beat.overlay = op.overlay;
        touched.push(beat.id);
        break;
      case "split_beat": {
        if (beat.kind !== "narration" || !beat.script_text) {
          errors.push(`split_beat: ${beat.id} is not a narration beat`);
          break;
        }
        const sentences = splitSentences(beat.script_text);
        if (op.after_sentence < 1 || op.after_sentence >= sentences.length) {
          errors.push(
            `split_beat: ${beat.id} has ${sentences.length} sentence(s); after_sentence must be 1..${sentences.length - 1}`
          );
          break;
        }
        const head = sentences.slice(0, op.after_sentence).join(" ");
        const tail = sentences.slice(op.after_sentence).join(" ");
        const maxId = Math.max(...next.beats.map((b) => parseInt(b.id.slice(1), 10) || 0));
        const newBeat: Beat = {
          ...structuredClone(beat),
          id: `b${maxId + 1}`,
          script_text: tail,
        };
        delete newBeat.overlay; // the overlay stays with the head
        delete newBeat.anchors;
        beat.script_text = head;
        // anchors whose source_words moved to the tail follow it
        if (beat.anchors) {
          const headNorm = head.toLowerCase();
          const moved = beat.anchors.filter((a) => !headNorm.includes(a.source_words.toLowerCase()));
          if (moved.length) {
            newBeat.anchors = moved;
            beat.anchors = beat.anchors.filter((a) => headNorm.includes(a.source_words.toLowerCase()));
            if (beat.overlay?.anchor_ref !== undefined && beat.overlay.anchor_ref >= (beat.anchors?.length ?? 0)) {
              delete beat.overlay;
            }
          }
        }
        next.beats.splice(idx + 1, 0, newBeat);
        touched.push(beat.id, newBeat.id);
        break;
      }
      case "merge_with_next": {
        const nextBeat = next.beats[idx + 1];
        if (!nextBeat || nextBeat.kind !== "narration" || beat.kind !== "narration") {
          errors.push(`merge_with_next: ${beat.id} and its successor must both be narration beats`);
          break;
        }
        beat.script_text = `${beat.script_text} ${nextBeat.script_text}`.replace(/\s+/g, " ").trim();
        beat.anchors = [...(beat.anchors ?? []), ...(nextBeat.anchors ?? [])];
        if (!beat.anchors.length) delete beat.anchors;
        next.beats.splice(idx + 1, 1);
        touched.push(beat.id);
        break;
      }
    }
  }
  if (errors.length) return { ok: false, errors, touched };
  return { ok: true, errors: [], beats: next, touched };
}
