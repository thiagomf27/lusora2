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
  /** v1.1 (D59): lifts a moment rather than carrying a fact; counted under its
   *  own density budget, and only allowed when the style pack enables it. */
  emphasis?: boolean;
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
  typography: {
    display: string;
    body: string;
    caption_preset: string;
    /** D66 — multiplier over every fontSize ratio, per type role. */
    scale?: "compact" | "normal" | "generous";
    /** D66 — offset on the component's own fontWeight. */
    weight?: "light" | "regular" | "bold";
    /** D66 — `as_written` keeps whatever the component set. */
    case?: "as_written" | "upper";
    /** D66 — em offset on the component's own letterSpacing. */
    tracking?: "tight" | "normal" | "wide";
  };
  motion_feel?: "slow_heavy" | "neutral" | "fast_light";
  grain?: "none" | "archival" | "film";
  /** D46 — the shape of an overlay. Omitted tokens keep the pre-D46 look. */
  surface?: {
    radius?: "square" | "soft" | "rounded";
    fill?: "solid" | "translucent" | "none";
    /** Omitted keeps each component's own placement. */
    accent_rule?: "top" | "left" | "none";
    /** D66 — multiplier on padding, gaps, margins and panel insets. */
    density?: "tight" | "normal" | "airy";
    /** D66 — multiplier on the width of every rule the component draws. */
    rule?: "hairline" | "normal" | "heavy";
    /** D66 — treatment on the ground an overlay sets type on. Distinct from
     *  top-level `grain`, which is a post-look over the whole frame. */
    texture?: "none" | "paper" | "grain" | "scanline";
  };
  /** D66 — how a plotted component reads. `grid`, `legend` and `markers` carry
   *  no default: there is no identity element for a choice, so omitted keeps
   *  each component's own (the `accent_rule` precedent). */
  chart?: {
    grid?: "none" | "horizontal" | "full";
    legend?: "inline" | "bottom";
    /** D69 — whether a line encloses the space under it. */
    area?: "none" | "tint";
    markers?: "none" | "dot";
    stroke?: "hairline" | "normal" | "heavy";
    number_format?: "plain" | "compact";
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
    /** D55/D58: post-alignment floor and ceiling, as multiples of min/max hold. */
    hold_floor_ratio?: number;
    hold_ceiling_ratio?: number;
  };
  overlays: {
    density: OverlayDensity;
    /** Component packs the planner may draw from. Omitted means every pack.
     *  Per-component trimming is the channel's, via `look.exclude.components`. */
    allowed_packs?: string[];
    /** D59: a second overlay class, counted under its own budget. */
    emphasis?: { enabled?: boolean; per_minute?: number };
  };
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
  /** D55: the card drawn instead of an asset the chain could not match well. */
  fallback?: { component?: string; text_prop?: string };
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

export type PromptRole = "script" | "research" | "planner" | "spine" | "chat";

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
  /**
   * D66: HOW this channel's videos are produced — the channel-side counterpart
   * of a manifest's `category`. The resolver at enqueue turns it into a
   * pipeline name. Orthogonal to `video_type`, which is WHAT the video is.
   */
  production_style?: PipelineCategory;
  /** D60: pipeline manifest name (contracts/pipelines/<name>.yaml), pinning
   *  one exact stage list and overriding `production_style`. */
  pipeline?: string;
  /**
   * D62: how far the worker runs before asking a human. `guided` (REVIEW in
   * the UI) stops after every stage the manifest gates; `auto` runs straight
   * through. Absent = the manifest's `default_checkpoint_policy`.
   */
  checkpoint_policy?: CheckpointPolicy;
  /** D63: what a cue in subtitles.srt is — read by the transcript stage. */
  transcript?: { granularity?: SrtGranularity };
  voice: { provider: string; voice_id?: string };
  script?: {
    generator?: string;
    llm?: string;
    model?: string;
    prompt?: string;
    target_seconds?: number;
    /** D64: phase 0 of this agent — a research brief written before any
     *  prose. Shares script.llm/model, exactly as the spine shares the
     *  planner's, so it is a phase of a bounded agent and not a new one. */
    research?: { enabled?: boolean; prompt?: string };
  };
  planner?: { llm?: string; model?: string; prompt?: string };
  chat?: { llm?: string; model?: string; prompt?: string };
  captions?: { enabled?: boolean };
  renderer?: "auto" | "ffmpeg" | "remotion";
  /**
   * The SUBTRACTIVE half of the look: what this channel (or this one video)
   * leaves out of what the theme and style pack offer, plus the plate drawn
   * behind an overlay that does not fill the frame. Applied to the embedded
   * theme_doc / style_pack_doc at enqueue, so nothing downstream reads it.
   */
  look?: {
    background?: { image?: string | null; fit?: "cover" | "contain" };
    exclude?: {
      components?: string[];
      transitions?: TransitionType[];
      sfx_cues?: ("entrance" | "transition")[];
      moods?: Mood[];
    };
  };
  output?: { fps?: number; width?: number; height?: number };
  budget?: { max_usd_per_video: number };
  retention?: { clips?: "on_render" | "on_posted" | "keep"; final_mp4_days_after_posted?: number };
  content_rules?: string;
  source_policy: {
    visual: {
      chain: VisualSource[];
      max_clip_seconds?: number;
      orientation?: "landscape" | "portrait" | "square";
      /** D55: under this score the chain's answer is replaced by a typographic
       *  card instead of placed. 0 = off. */
      min_score_floor?: number;
      /** D55: how a slot longer than its footage is covered, first applicable wins. */
      short_clip_fallback?: ("loop" | "slow" | "freeze")[];
      /** D54: how hard this channel works not to show the same shot twice. */
      dedup?: { reuse_window_items?: number; min_hamming_distance?: number };
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
  /** Full pipeline manifest, embedded at enqueue (D60, snapshot). */
  pipeline_doc?: PipelineManifest;
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

/** D62 — the same enum as a manifest's `default_checkpoint_policy`: the
 *  video-level value overrides the manifest-level one. */
export type CheckpointPolicy = "auto" | "guided";

/** D63 — what one cue in subtitles.srt spans. */
export type SrtGranularity = "sentence" | "word" | "segment";

export type VideoStatus =
  | "draft"
  | "queued"
  | "producing"
  /** D62: stopped at a review-mode gate, waiting for a human to approve. */
  | "awaiting_approval"
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

// ---------- pipeline manifest (D60) ----------

/**
 * The stage list as data. The manifest declares POLICY (which stages run, in
 * what order, what each produces); the worker's step registry owns MECHANISM
 * (the callable behind a name and how it decides it is already done).
 */
export interface PipelineStage {
  name: string;
  requires?: string[];
  produces?: string[];
  checkpoint_required?: boolean;
  /** D62: under guided policy the worker stops here and waits for a human. */
  human_approval_on_review_mode?: boolean;
  /** D62: a human may hand this stage's artifact in instead (manual-first). */
  receivable_on_upload?: boolean;
  substages?: PipelineSubstage[];
}

export interface PipelineSubstage {
  name: string;
  requires?: string[];
  produces?: string[];
  checkpoint_required?: boolean;
  receivable_on_upload?: boolean;
}

export type PipelineCategory =
  | "faceless"
  | "talking_head"
  | "ultra_longform"
  | "shorts"
  | "animation"
  | "custom";

export interface PipelineManifest {
  name: string;
  version: string;
  description?: string;
  category?: PipelineCategory;
  stability?: "production" | "test";
  default_checkpoint_policy?: CheckpointPolicy;
  bulk_production_accepted?: boolean;
  orchestration?: {
    mode?: "mainly_code";
    budget_default_usd?: number;
    max_revisions_per_stage?: number;
    max_send_backs?: number;
  };
  compatible_themes?: {
    recommended?: string[];
    also_works?: string[];
    custom_allowed?: boolean;
  };
  stages: PipelineStage[];
}
