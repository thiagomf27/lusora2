/**
 * Brand background library: the images a channel can put behind an overlay
 * that does not fill the frame.
 *
 * Files on disk, one folder per channel, exactly like the video folders — the
 * DB stays the control plane and never holds bytes. The chosen file is COPIED
 * into the video folder at enqueue (see enqueueVideo), so a render resolves it
 * like any other asset and re-uploading a background never alters a video that
 * already shipped (Principle 7).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import { loadEnv, repoRoot } from "./env.ts";
import { ApiError } from "./auth.ts";

/** Formats both renderers can draw: ffmpeg reads them, Remotion's <Img> does too. */
export const BACKGROUND_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
export const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024;

/** No path separators, no dotfiles, a known image extension. */
export const BACKGROUND_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$/i;

export function backgroundsRoot(): string {
  loadEnv();
  const root = process.env.BRAND_ASSETS_ROOT ?? join(repoRoot(), "data/brand-backgrounds");
  return isAbsolute(root) ? root : join(repoRoot(), root);
}

export function channelBackgroundsDir(channelId: string): string {
  // channel ids come from the DB, but this builds a filesystem path — check anyway
  if (!/^[A-Za-z0-9._-]+$/.test(channelId)) throw new ApiError(400, "invalid channel id");
  return join(backgroundsRoot(), channelId);
}

export function backgroundPath(channelId: string, name: string): string {
  if (!BACKGROUND_NAME_RE.test(name)) {
    throw new ApiError(400, `invalid background name '${name}' — letters, digits, . _ - and a .png/.jpg/.webp extension`);
  }
  const dir = resolve(channelBackgroundsDir(channelId));
  const file = resolve(join(dir, name));
  if (!file.startsWith(dir + sep)) throw new ApiError(400, "invalid background name");
  return file;
}

export interface BackgroundRow {
  name: string;
  bytes: number;
  modified: string;
}

export function listBackgrounds(channelId: string): BackgroundRow[] {
  const dir = channelBackgroundsDir(channelId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => BACKGROUND_EXTENSIONS.includes(extname(f).toLowerCase()))
    .sort()
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, bytes: st.size, modified: st.mtime.toISOString() };
    });
}

export function deleteBackground(channelId: string, name: string): void {
  const file = backgroundPath(channelId, name);
  if (!existsSync(file)) throw new ApiError(404, `background '${name}' not found`);
  rmSync(file);
}

export function ensureBackgroundsDir(channelId: string): string {
  const dir = channelBackgroundsDir(channelId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
