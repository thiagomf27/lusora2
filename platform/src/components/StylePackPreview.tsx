"use client";
/**
 * Preview of a style pack. There is nothing to render — a pack is behavior,
 * not appearance — so the preview shows what the numbers will DO: the shot
 * rhythm, and the budgets the worker will actually enforce on the plan. The
 * budgets come from lib/pacing.ts, which mirrors validators.py.
 */
import type { StylePack } from "@lusora/contracts";
import { beatRange, densityPerMinute, overlayBudget } from "@/lib/pacing";
import s from "./StylePackPreview.module.css";

const WINDOW_S = 60;
const REFERENCE_S = 600;

/** One minute of video: shots at avg_hold, overlay ticks at the density. */
export function RhythmStrip({ pack, small = false }: { pack: StylePack; small?: boolean }) {
  const avg = pack.pacing.avg_hold_seconds;
  const shots = avg > 0 ? Math.min(Math.round(WINDOW_S / avg), 60) : 0;
  const overlays = Math.min(Math.round(densityPerMinute(pack.overlays.density)), 30);

  return (
    <div className={`${s.strip}${small ? " " + s.stripSmall : ""}`}>
      {Array.from({ length: shots }, (_, i) => (
        <div key={i} className={s.shot} style={{ width: `${100 / shots}%` }} />
      ))}
      {Array.from({ length: overlays }, (_, i) => (
        <div
          key={`o${i}`}
          className={`${s.tick}${small ? " " + s.tickSmall : ""}`}
          style={{ left: `${((i + 0.5) / overlays) * 100}%` }}
        />
      ))}
    </div>
  );
}

export function StylePackStats({ pack }: { pack: StylePack }) {
  const avg = pack.pacing.avg_hold_seconds;
  const perMinute = densityPerMinute(pack.overlays.density);
  const [lo, hi] = beatRange(avg, REFERENCE_S);
  const allowedPacks = pack.overlays.allowed_packs;

  return (
    <div className={s.stats}>
      <div className={s.stat}>
        <div className={s.statLabel}>SHOTS</div>
        <div className={s.statValue}>{avg > 0 ? (60 / avg).toFixed(1) : "—"}/min</div>
        <div className={s.statNote}>
          holds clamped to {pack.pacing.min_hold}–{pack.pacing.max_hold}s
        </div>
      </div>
      <div className={s.stat}>
        <div className={s.statLabel}>OVERLAYS</div>
        <div className={s.statValue}>{perMinute}/min</div>
        <div className={s.statNote}>
          up to {overlayBudget(pack.overlays.density, REFERENCE_S)} in a 10-min video
        </div>
      </div>
      <div className={s.stat}>
        <div className={s.statLabel}>BEATS (10 MIN)</div>
        <div className={s.statValue}>
          {lo}–{hi}
        </div>
        <div className={s.statNote}>validate rejects a plan outside this range</div>
      </div>
      <div className={s.stat}>
        <div className={s.statLabel}>MENU</div>
        <div className={s.statValue}>
          {allowedPacks ? allowedPacks.join(", ") : "all packs"}
        </div>
        <div className={s.statNote}>
          {allowedPacks
            ? "component packs a channel may install to use this style"
            : "no restriction — any component pack"}
        </div>
      </div>
    </div>
  );
}

export function StylePackLanguage({ pack }: { pack: StylePack }) {
  const rows: [string, string | undefined][] = [
    ["SCRIPT PERSONA → script agent", pack.script_persona],
    ["VISUAL LANGUAGE → beat planner", pack.visual_language],
  ];
  return (
    <div className={s.texts}>
      {rows.map(([label, body]) => (
        <div key={label} className={s.text}>
          <div className={s.textLabel}>{label}</div>
          {body?.trim() ? (
            <div className={s.textBody}>{body}</div>
          ) : (
            <div className={s.textEmpty}>not set — the agent falls back to its own default</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function TransitionChips({ pack }: { pack: StylePack }) {
  return (
    <div className={s.chips}>
      {pack.transitions.allowed.map((t) => (
        <span key={t} className={`${s.chip}${t === pack.transitions.default ? " " + s.chipOn : ""}`}>
          {t}
          {t === pack.transitions.default ? " · default" : ""}
        </span>
      ))}
    </div>
  );
}
