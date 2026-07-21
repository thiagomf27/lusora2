/**
 * Apply the chat agent's EditOps (contracts/ui_api_interface.json — closed
 * set) to the working plan using the SAME pure mutations the timeline and
 * properties panel use. The server already validated the ops against the
 * shared validator; applying a whole chat turn is one undo step.
 */

import type { AudioItem, EditPlan, VisualItem } from "@engine/player";
import type { EditOp } from "../types";
import * as m from "./mutations";

export function applyEditOps(plan: EditPlan, ops: EditOp[]): EditPlan {
  let current = plan;
  for (const raw of ops) {
    // the server validated shape + result; fields are trusted here
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const op = raw as Record<string, any>;
    switch (raw.op) {
      case "move_cut_point":
        current = m.moveCutPoint(current, op["index"], op["to"]);
        break;
      case "set_caption_text":
        current = m.setCaptionText(current, op["index"], op["text"]);
        break;
      case "retime_item":
        current = m.retimeItem(current, op["track"], op["index"], op["start"], op["end"]);
        break;
      case "set_transition":
        current = m.setVisualFields(current, op["index"], {
          transition_out: (op["transition_out"] ?? null) as VisualItem["transition_out"],
          transition_duration: (op["transition_duration"] ?? null) as VisualItem["transition_duration"],
        });
        break;
      case "add_overlay":
        current = m.addOverlay(current, op["component"], op["start"], op["end"], op["props"]);
        break;
      case "remove_overlay":
        current = m.deleteItem(current, "overlays", op["index"]);
        break;
      case "set_overlay_props":
        current = m.setOverlayProps(current, op["index"], op["props"]);
        break;
      case "set_visual_query":
        current = m.setVisualQuery(current, op["index"], op["broll_query"], op["media_type"]);
        break;
      case "split_visual":
        current = m.splitVisual(current, op["index"], op["at"]);
        break;
      case "add_audio":
        current = m.addAudio(current, {
          role: op["role"],
          asset_path: op["asset_path"],
          start: op["start"],
          end: op["end"],
          volume: (op["volume"] ?? 1.0) as AudioItem["volume"],
          loop: (op["loop"] ?? false) as AudioItem["loop"],
          fade_in: (op["fade_in"] ?? null) as AudioItem["fade_in"],
          fade_out: (op["fade_out"] ?? null) as AudioItem["fade_out"],
        });
        break;
      case "set_audio_props": {
        const fields: Partial<AudioItem> = {};
        for (const key of ["volume", "loop", "fade_in", "fade_out"] as const) {
          if (key in op) (fields as Record<string, unknown>)[key] = op[key];
        }
        current = m.setAudioFields(current, op["index"], fields);
        break;
      }
      default:
        console.warn(`chat: ignoring unknown op '${raw.op}'`);
    }
  }
  return current;
}
