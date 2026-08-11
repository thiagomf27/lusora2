/**
 * Hand-written TypeScript mirrors of the JSON Schemas in ../schemas.
 * The JSON Schemas are the source of truth; these types must match them.
 * (CI validates fixtures against the schemas; drift shows up there.)
 */

// ---------- beat sheet ----------

export type AnchorType =
  | "percentage"
  | "number"
  | "comparison"
  | "place"
  | "date"
  | "name"
  | "quote";

export interface Anchor {
  type: AnchorType;
  value?: number | string | unknown[] | Record<string, unknown>;
  label?: string;
  source_words: string;
}

export interface BeatOverlay {
  component: string;
  anchor_ref?: number;
  props_hint?: Record<string, unknown>;
}

/**
 * D48 — the mood vocabulary. `Beat.mood` stays a plain string: an unrecognised
 * mood degrades to "neutral" in the compiler rather than failing a video over a
 * word choice, so this is the set that MEANS something, not the set that is legal.
 */
export const MOODS = [
  "neutral",
  "tense",
  "somber",
  "hopeful",
  "urgent",
  "triumphant",
  "reflective",
  "playful",
] as const;

export type Mood = (typeof MOODS)[number];

export interface Beat {
  id: string;
  kind: "narration" | "timed";
  script_text?: string;
  timing?: { start_s: number; end_s: number };
  /** Semantic search query + image-generation prompt. Keyword stock search uses `queries`. */
  visual_intent: string;
  /** v1.1 (D53): 2-3 short keyword queries for word-matching stock libraries, tried in order. */
  queries?: string[];
  /** A Mood in practice; typed loose because unknown values degrade, not fail. */
  mood?: string;
  media_preference?: "video" | "image" | "any";
  anchors?: Anchor[];
  overlay?: BeatOverlay;
  notes?: string | null;
}

export interface MusicSpan {
  start_beat: string;
  end_beat: string;
  intent: string;
  volume?: "low" | "medium" | "high";
}

export interface BeatSheet {
  version: "1.0" | "1.1";
  video_id: string;
  beats: Beat[];
  music?: MusicSpan[];
}

// ---------- edit plan ----------

export type AssetSourceKind = "library" | "stock" | "ai" | "upload" | "manual";

export interface AssetProvenance {
  source: AssetSourceKind;
  id?: string | null;
  provider?: string | null;
  license?: string | null;
  path: string;
  score?: number | null;
  query?: string | null;
}

export interface Motion {
  type: "none" | "ken_burns";
  direction?: "in" | "out";
  pan?: "center" | "left" | "right" | "up" | "down";
  strength?: number;
}

export type TransitionType = "cut" | "crossfade" | "fade" | "fade_to_black";

export interface Transition {
  type: TransitionType;
  duration_s?: number;
}

export interface VisualItem {
  id: string;
  beat_id?: string | null;
  locked?: boolean;
  start_s: number;
  end_s: number;
  media_type: "video" | "image" | "avatar" | "color";
  asset: AssetProvenance;
  in_offset_s?: number;
  motion?: Motion;
  transition_out?: Transition;
  mute?: boolean;
  /** Playback rate multiplier for video assets; 1.0 = normal (Remotion path only). */
  speed?: number;
  /** Repeat a video source that is shorter than the item, instead of freezing on its last frame. */
  loop?: boolean;
  /**
   * Beats too short to hold on their own (style pack pacing.hold_floor_ratio),
   * now playing under this item's shot. Provenance: they keep their overlays.
   */
  absorbed_beat_ids?: string[];
}

export interface OverlayItem {
  id: string;
  beat_id?: string | null;
  locked?: boolean;
  start_s: number;
  end_s: number;
  kind: "component" | "media";
  component?: string;
  props?: Record<string, unknown>;
  /** template kind, compiled in from the catalog entry when it has no React component */
  template?: TemplateKind;
  asset?: AssetProvenance;
  transform?: {
    scale?: number;
    position?: "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";
  };
}

export type CaptionInEffect = "fade" | "pop" | "slide_up";
export type CaptionOutEffect = "fade" | "pop" | "slide_down";

export interface CaptionItem {
  start_s: number;
  end_s: number;
  text: string;
  in_effect?: CaptionInEffect | null;
  out_effect?: CaptionOutEffect | null;
  /** D56 — compiled position: gap from the bottom edge, as a fraction of frame
   *  height. Written when a graphic occupies the caption band for this span. */
  bottom_fraction?: number;
}

export interface VoiceoverItem {
  path: string;
  start_s?: number;
  duration_s: number;
  volume?: number;
}

/**
 * D48 — piecewise-linear absolute-time gain, computed by the compiler from the
 * real sentence timings. This is how ducking works: no DSP, no sidechain, the
 * same numbers on both render paths, visible and editable in the plan.
 */
export interface GainPoint {
  t_s: number;
  gain: number;
}

export interface MusicItem {
  /** Absent on pre-D48 plans, which address music by index. */
  id?: string;
  path: string;
  start_s: number;
  end_s?: number | null;
  volume?: number;
  loop?: boolean;
  fade_in_s?: number;
  fade_out_s?: number;
  mood?: Mood;
  gain_envelope?: GainPoint[];
  asset?: AssetProvenance;
}

export type SfxOrigin = "overlay" | "transition" | "manual";

export interface SfxItem {
  id: string;
  beat_id?: string | null;
  locked?: boolean;
  start_s: number;
  end_s: number;
  path: string;
  gain?: number;
  /** Cue name in the sound pack that produced this item. */
  cue?: string;
  origin?: SfxOrigin;
  /** The overlay or visual item this cue belongs to. */
  origin_id?: string | null;
  loop?: boolean;
  fade_in_s?: number;
  fade_out_s?: number;
  asset?: AssetProvenance;
}

export interface EditPlan {
  version: "1.0";
  video_id: string;
  fps: number;
  resolution: { width: number; height: number };
  tracks: {
    visual: VisualItem[];
    overlays: OverlayItem[];
    captions: { enabled: boolean; preset?: string; items: CaptionItem[] };
    audio: { voiceover: VoiceoverItem; music?: MusicItem[]; sfx?: SfxItem[] };
  };
}

// ---------- theme & style pack ----------

/** D46 — how an overlay arrives. A request: components degrade to "fade". */
export type Entrance = "fade" | "rise" | "slide" | "pop" | "wipe" | "typewriter";

export interface Theme {
  name: string;
  colors: { bg: string; text: string; accent: string; neutral: string };
  typography: { display: string; body: string; caption_preset: string };
  motion_feel?: "slow_heavy" | "neutral" | "fast_light";
  grain?: "none" | "archival" | "film";
  /** D46 — the shape of an overlay. Omitted tokens keep the pre-D46 look. */
  surface?: {
    radius?: "square" | "soft" | "rounded";
    fill?: "solid" | "translucent" | "none";
    /** Omitted keeps each component's own placement. */
    accent_rule?: "top" | "left" | "none";
  };
  /** D46 — how an overlay arrives. Duration scaling stays in motion_feel. */
  motion?: {
    entrance?: Entrance;
    easing?: "smooth" | "snap" | "spring" | "linear";
    /** Keyed by catalog component name. Sparse by design (D47). */
    per_component?: Record<string, Entrance>;
  };
  /** D48 — how a theme SOUNDS. Names cues from a sound pack, the way
   *  typography names packaged fonts. Omitted = a silent video, as before. */
  sound?: ThemeSound;
}

/** A cue or bed name in the resolved sound pack, or "none" to silence. */
export type CueRef = string;

export interface ThemeSound {
  pack?: string;
  /** Omitted means no entrance sfx: silence is the default, not a fallback swoosh. */
  entrance?: CueRef;
  /** Keyed by the entrance kind that actually plays, after support resolution. */
  per_entrance?: Partial<Record<Entrance, CueRef>>;
  /** Keyed by catalog component name. Exceptions only, like motion.per_component. */
  per_component?: Record<string, CueRef>;
  /** Omitted (the default) means none — a cue per transition is ~15/minute. */
  transition?: CueRef;
  mood_beds?: Partial<Record<Mood, CueRef>>;
  gain?: { sfx?: number; music_duck?: number; music_lift?: number };
}

export type OverlayDensity = "low" | "normal" | "high" | { per_minute: number };

export type VideoType = "doc" | "explainer" | "breakdown" | "listicle";

export interface StylePack {
  name: string;
  /** The video-type preset this pack implements — a video type IS a style pack
   *  with different numbers, so the channel's video_type picks among packs. */
  video_type?: VideoType;
  pacing: {
    avg_hold_seconds: number;
    min_hold: number;
    max_hold: number;
    arc?: "three_act" | "linear" | "listicle";
  };
  overlays: { density: OverlayDensity; allowed_components?: string[] };
  transitions: { allowed: TransitionType[]; default: TransitionType };
  script_persona?: string;
  visual_language?: string;
  /** D45: narration length lives with the pacing numbers it interacts with,
   *  and is overridable per video like overlays.density. */
  script?: { target_seconds?: number; tolerance?: number; prompt?: string };
  /** D48: how OFTEN cues fire. The theme picks which sound; this picks how many. */
  sfx?: {
    enabled?: boolean;
    cues?: ("entrance" | "transition")[];
    max_per_minute?: number;
    min_gap_s?: number;
  };
  /** D48: how background music is shaped across the video. */
  music?: { enabled?: boolean; min_span_s?: number; crossfade_s?: number };
}

// ---------- sound pack (D48) ----------

export interface SoundCue {
  file: string;
  kind: "one_shot" | "loop";
  duration_s: number;
  /** Start this many seconds BEFORE the visual, so the transient lands on it. */
  lead_s?: number;
  gain?: number;
  /** On a min-gap collision, the higher priority cue survives. */
  priority?: number;
  fade_out_s?: number;
}

export interface SoundBed {
  file: string;
  mood: Mood;
  duration_s: number;
  loopable?: boolean;
  gain?: number;
}

export interface SoundPack {
  name: string;
  license: LicenseKind;
  attribution?: string;
  cues: Record<string, SoundCue>;
  beds: Record<string, SoundBed>;
}

// ---------- prompts (D42-D44) ----------

export type PromptRole = "script" | "planner" | "chat";

/** The EDITABLE half of an agent prompt; the welded contract half lives in
 *  contracts/prompts/welded/ and is appended by code at call time. */
export interface Prompt {
  name: string;
  role: PromptRole;
  video_type?: VideoType;
  description?: string;
  system: string;
  user?: string;
  model_hint?: string | null;
  max_tokens?: number | null;
}

/** What the cfg snapshot carries per role: text, not a name (D44). */
export interface ResolvedPrompt {
  name: string;
  source: "video" | "channel" | "style_pack" | "default";
  system: string;
  user?: string;
  model_hint?: string | null;
  max_tokens?: number | null;
}

// ---------- channel config ----------

export type LicenseKind =
  | "cc0"
  | "cc-by"
  | "cc-by-sa"
  | "owned"
  | "stock-licensed"
  | "unknown";

export interface VisualSource {
  source: "library" | "stock" | "ai_image";
  media_types?: ("video_clip" | "image" | "video")[];
  profile?: string;
  include_global?: boolean;
  niches?: string[];
  tags?: string[];
  licenses?: LicenseKind[];
  min_score?: number;
  providers?: string[];
  provider?: string;
  style?: string;
}

export interface ChannelConfig {
  channel_id: string;
  name: string;
  language: string;
  video_type: VideoType;
  theme: string;
  style_pack: string;
  component_pack?: string | null;
  voice: { provider: string; voice_id?: string };
  script?: {
    generator?: string;
    llm?: string;
    model?: string;
    prompt?: string;
    target_seconds?: number;
  };
  planner?: { llm?: string; model?: string; prompt?: string };
  chat?: { llm?: string; model?: string; prompt?: string };
  captions?: { enabled?: boolean };
  renderer?: "auto" | "ffmpeg" | "remotion";
  output?: { fps?: number; width?: number; height?: number };
  budget?: { max_usd_per_video: number };
  retention?: { clips?: "on_render" | "on_posted" | "keep"; final_mp4_days_after_posted?: number };
  content_rules?: string;
  source_policy: {
    visual: {
      chain: VisualSource[];
      max_clip_seconds?: number;
      orientation?: "landscape" | "portrait" | "square";
    };
    /** D48: overrides theme.sound.pack. */
    sound_pack?: string;
    music?: {
      enabled?: boolean;
      chain?: { source: "audio_library"; tags?: string[] }[];
      default_volume?: number;
    };
    sfx?: { enabled?: boolean; default_gain?: number };
  };
  overrides?: Record<string, unknown>;
  style_pack_doc?: StylePack;
  theme_doc?: Theme;
  /** Full sound pack manifest, embedded at enqueue. Absent = silent video. */
  sound_pack_doc?: SoundPack;
  /** Resolved prompt text per role, snapshotted at enqueue (D44). */
  prompts?: Partial<Record<PromptRole, ResolvedPrompt>>;
}

// ---------- catalog ----------

export interface CatalogPropSpec {
  type?: "number" | "string" | "boolean" | "array" | "object";
  enum?: unknown[];
  min?: number;
  max?: number;
  maxWords?: number;
  items?: CatalogPropSpec;
  properties?: Record<string, CatalogPropSpec>;
  required?: boolean;
  default?: unknown;
  from_anchor?: string;
  computed?: "geocode" | "parse_date" | "geocode_stops";
  description?: string;
}

/** Layouts the engine can draw from data alone (engine/src/components/templates). */
export type TemplateKind = "card" | "lower_third" | "big_number" | "bullet_list" | "statement";

export interface CatalogEntry {
  name: string;
  pack: string;
  when_to_use: string;
  when_not_to_use: string;
  anchor_types: AnchorType[];
  props: Record<string, CatalogPropSpec>;
  /** set instead of shipping a React component: TemplateOverlay draws it */
  template?: TemplateKind;
  /** D56 — the vertical band this component draws in, as fractions from the
   *  top. Lets the compiler tell whether a graphic actually lands on the
   *  captions; absent means "assume it does". */
  region?: { y_min: number; y_max: number };
  duration_hint_s?: { min?: number; default?: number; max?: number };
  /** D48 — the `seconds` this component passes to useEntrance, before
   *  motion_feel scaling. Declared so the compiler can compute the real
   *  entrance window without importing the engine. Set only when it differs
   *  from the 0.45 default. */
  entrance_seconds?: number;
  /** D48 — which entrances this component can draw, mirroring the constant it
   *  passes to useEntrance, so the compiler resolves the SAME kind the
   *  renderer will play. */
  entrance_support?: "panel" | "text";
  renderer: "remotion";
}

export interface Catalog {
  version: string;
  generated_by: string;
  components: CatalogEntry[];
}

// ---------- costs ----------

export type CostStatus = "estimated" | "reserved" | "completed" | "failed" | "refunded";

export interface CostEvent {
  video_id?: string | null;
  channel_id?: string | null;
  provider: string;
  operation: string;
  status: CostStatus;
  units: number;
  unit_price_usd: number;
  usd: number;
  ts?: string;
  details?: Record<string, unknown>;
}

// ---------- control plane ----------

export type UserRole = "admin" | "manager" | "editor";

export type VideoStatus =
  | "draft"
  | "queued"
  | "producing"
  | "rendered"
  | "in_review"
  | "approved"
  | "sent_back"
  | "posted"
  | "error";

export type EventStatus = "started" | "progress" | "done" | "failed";

export interface VideoEvent {
  id: number;
  video_id: string;
  stage: string;
  status: EventStatus;
  message?: string | null;
  ts: string;
}
