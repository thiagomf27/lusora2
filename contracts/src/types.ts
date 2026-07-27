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

export interface Beat {
  id: string;
  kind: "narration" | "timed";
  script_text?: string;
  timing?: { start_s: number; end_s: number };
  visual_intent: string;
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
  version: "1.0";
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
}

export interface VoiceoverItem {
  path: string;
  start_s?: number;
  duration_s: number;
  volume?: number;
}

export interface MusicItem {
  path: string;
  start_s: number;
  end_s?: number | null;
  volume?: number;
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
    audio: { voiceover: VoiceoverItem; music?: MusicItem[]; sfx?: MusicItem[] };
  };
}

// ---------- theme & style pack ----------

export interface Theme {
  name: string;
  colors: { bg: string; text: string; accent: string; neutral: string };
  typography: { display: string; body: string; caption_preset: string };
  motion_feel?: "slow_heavy" | "neutral" | "fast_light";
  grain?: "none" | "archival" | "film";
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
  script?: { generator?: string; llm?: string };
  planner?: { llm?: string };
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
    music?: {
      enabled?: boolean;
      chain?: { source: "audio_library"; tags?: string[] }[];
      default_volume?: number;
    };
    sfx?: { enabled?: boolean };
  };
  overrides?: Record<string, unknown>;
  style_pack_doc?: StylePack;
  theme_doc?: Theme;
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
  duration_hint_s?: { min?: number; default?: number; max?: number };
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
