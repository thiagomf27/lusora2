/**
 * The plan store — the UI's working copy of edit_plan.json.
 *
 * edit_plan.json stays the single source of truth on disk; here we keep
 * savedPlan (what the server has) and workingPlan (with unsaved edits).
 * Every mutation is applied as a pure function on a clone and pushed onto
 * the undo stack with its snapshots (undo = restore before, redo = after).
 * Saving PUTs the full plan; the server validates with the same checks as
 * the pipeline's validate_plan and writes atomically — the UI can never
 * bypass validation. A debounced background validate powers the issues badge.
 */

import { create } from "zustand";
import type { EditPlan, VisualAsset } from "@engine/player";
import { api, ApiError } from "../api";
import type { CfgSlice } from "../types";

export interface Mutation {
  label: string;
  before: EditPlan;
  after: EditPlan;
}

interface PlanStore {
  videoId: string | null;
  title: string;
  savedPlan: EditPlan | null;
  workingPlan: EditPlan | null;
  savedHash: string;
  cfg: CfgSlice | null;
  voiceoverDuration: number | null;
  assets: VisualAsset[];
  undoStack: Mutation[];
  redoStack: Mutation[];
  issues: string[];
  loadError: string | null;
  saving: boolean;
  saveError: string | null;

  loadVideo: (id: string, title: string) => Promise<void>;
  closeVideo: () => void;
  applyEdit: (label: string, mutate: (plan: EditPlan) => EditPlan) => void;
  /** Live drag updates: replace workingPlan WITHOUT an undo entry... */
  setTransient: (plan: EditPlan) => void;
  /** ...then commit the whole gesture as ONE undo step (before = pre-drag snapshot). */
  commitTransient: (label: string, before: EditPlan) => void;
  /** Replace state from a server PlanPayload (e.g. after assets/download). */
  adoptServerPlan: (plan: EditPlan, hash: string) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<boolean>;
  refreshManifest: () => Promise<void>;
}

let validateTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleValidate(get: () => PlanStore, set: (partial: Partial<PlanStore>) => void): void {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(async () => {
    const { videoId, workingPlan } = get();
    if (!videoId || !workingPlan) return;
    try {
      const result = await api.validatePlan(videoId, workingPlan);
      // ignore stale responses: the plan may have changed while in flight
      if (get().workingPlan === workingPlan) set({ issues: result.errors });
    } catch {
      /* validation is advisory; save still enforces */
    }
  }, 400);
}

export const usePlanStore = create<PlanStore>((set, get) => ({
  videoId: null,
  title: "",
  savedPlan: null,
  workingPlan: null,
  savedHash: "",
  cfg: null,
  voiceoverDuration: null,
  assets: [],
  undoStack: [],
  redoStack: [],
  issues: [],
  loadError: null,
  saving: false,
  saveError: null,

  loadVideo: async (id, title) => {
    set({
      videoId: id, title, savedPlan: null, workingPlan: null, savedHash: "",
      cfg: null, voiceoverDuration: null, assets: [],
      undoStack: [], redoStack: [], issues: [], loadError: null, saveError: null,
    });
    try {
      const payload = await api.getPlan(id);
      const manifest = await api.getManifest(id).catch(() => ({ assets: [] }));
      set({
        savedPlan: payload.plan,
        workingPlan: payload.plan,
        savedHash: payload.plan_version_hash,
        cfg: payload.cfg,
        voiceoverDuration: payload.voiceover_duration,
        assets: manifest.assets,
      });
      scheduleValidate(get, set);
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : String(err) });
    }
  },

  closeVideo: () => {
    clearTimeout(validateTimer);
    set({
      videoId: null, title: "", savedPlan: null, workingPlan: null, savedHash: "",
      cfg: null, voiceoverDuration: null, assets: [],
      undoStack: [], redoStack: [], issues: [], loadError: null, saveError: null,
    });
  },

  applyEdit: (label, mutate) => {
    const before = get().workingPlan;
    if (!before) return;
    const after = mutate(structuredClone(before));
    set({
      workingPlan: after,
      undoStack: [...get().undoStack, { label, before, after }],
      redoStack: [],
      saveError: null,
    });
    scheduleValidate(get, set);
  },

  setTransient: (plan) => set({ workingPlan: plan }),

  commitTransient: (label, before) => {
    const after = get().workingPlan;
    if (!after || after === before) return;
    set({
      undoStack: [...get().undoStack, { label, before, after }],
      redoStack: [],
      saveError: null,
    });
    scheduleValidate(get, set);
  },

  adoptServerPlan: (plan, hash) => {
    const before = get().workingPlan;
    set({
      savedPlan: plan,
      workingPlan: plan,
      savedHash: hash,
      undoStack: before ? [...get().undoStack, { label: "server update", before, after: plan }] : [],
      redoStack: [],
    });
    scheduleValidate(get, set);
  },

  undo: () => {
    const { undoStack, redoStack } = get();
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    set({
      workingPlan: last.before,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, last],
    });
    scheduleValidate(get, set);
  },

  redo: () => {
    const { undoStack, redoStack } = get();
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    set({
      workingPlan: next.after,
      undoStack: [...undoStack, next],
      redoStack: redoStack.slice(0, -1),
    });
    scheduleValidate(get, set);
  },

  save: async () => {
    const { videoId, workingPlan } = get();
    if (!videoId || !workingPlan) return false;
    set({ saving: true, saveError: null });
    try {
      const payload = await api.putPlan(videoId, workingPlan);
      set({
        savedPlan: get().workingPlan,
        savedHash: payload.plan_version_hash,
        issues: [],
        saving: false,
      });
      return true;
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.detail)) {
        set({ issues: err.detail, saving: false, saveError: "validation failed — see issues" });
      } else {
        set({ saving: false, saveError: err instanceof Error ? err.message : String(err) });
      }
      return false;
    }
  },

  refreshManifest: async () => {
    const { videoId } = get();
    if (!videoId) return;
    try {
      const manifest = await api.getManifest(videoId);
      set({ assets: manifest.assets });
    } catch {
      /* keep the previous manifest; the Player falls back gracefully */
    }
  },
}));

/** Unsaved changes? Reference equality is enough: save/adopt re-point savedPlan. */
export function isDirty(state: { savedPlan: EditPlan | null; workingPlan: EditPlan | null }): boolean {
  return state.workingPlan !== null && state.workingPlan !== state.savedPlan;
}
