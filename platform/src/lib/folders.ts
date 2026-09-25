/**
 * Where video folders live. Its own module, with no database and no Next.js
 * import, so a command-line script (scripts/ab-fork.ts) can resolve a folder
 * exactly as the server does; videos.ts re-exports both.
 */
import { isAbsolute, join } from "node:path";
import { loadEnv, repoRoot } from "./env.ts";

export function videosRoot(): string {
  loadEnv();
  const root = process.env.VIDEOS_ROOT ?? join(repoRoot(), "data/videos");
  return isAbsolute(root) ? root : join(repoRoot(), root);
}

export function videoFolder(videoId: string): string {
  return join(videosRoot(), videoId);
}
