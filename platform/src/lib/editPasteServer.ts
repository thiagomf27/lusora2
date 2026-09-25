/**
 * The server-side half of the directed-edit paste: the parts that need the
 * database or the configured data root. Kept out of editPaste.ts so that module
 * stays importable by a test with neither.
 */
import type { ChannelConfig } from "@lusora/contracts";
import { one } from "../db/pool.ts";
import { ApiError } from "./auth.ts";
import { editPassLogPath } from "./editPaste.ts";
import { deepMerge } from "./merge.ts";
import { videosRoot } from "./videos.ts";

/**
 * The config a video on this channel would be made with: the channel's stored
 * config with this video's overrides merged — the same merge enqueue does, so
 * the paste is judged against the menu the video will actually have.
 */
export async function configForVideo(
  channelId: string,
  overrides: Record<string, unknown> | null | undefined
): Promise<Record<string, unknown>> {
  const row = await one<{ config: ChannelConfig }>("SELECT config FROM channels WHERE id = $1", [channelId]);
  if (!row) throw new ApiError(404, `channel ${channelId} not found`);
  return deepMerge(row.config as unknown as Record<string, unknown>, overrides ?? null);
}

export function logPath(): string {
  return editPassLogPath(videosRoot());
}

/** A paste session id from a client: short, plain, and never a path. */
export function sessionId(value: unknown): string {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new ApiError(400, "paste_session must be 8-64 letters, digits, - or _");
  return id;
}
