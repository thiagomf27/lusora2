import { existsSync, readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import type { StylePack, VideoType } from "@lusora/contracts";
import { handler, requireUser, requireRole, ApiError } from "@/lib/auth";
import { STYLE_PACK_NAME_RE, stylePackPath } from "@/lib/stylePacks";
import { validateAgainst } from "@/lib/validate";
import {
  VIDEO_TYPES,
  loadVideoTypeDefaults,
  writeVideoTypeDefaults,
  type VideoTypeDefaults,
} from "@/lib/videoTypeDefaults";

/**
 * The video type -> style pack defaults (`contracts/video-type-defaults.json`),
 * edited on the Style packs screen.
 *
 * Writes are checked the same way CI checks the file: the pack has to exist,
 * and it has to implement the type it is being made the default for. A default
 * that points at a pack for another type is not a preference, it is a channel
 * that will silently change shape the next time someone touches its video type.
 */
export const GET = handler(async () => {
  await requireUser();
  return NextResponse.json({ defaults: loadVideoTypeDefaults(), videoTypes: VIDEO_TYPES });
});

export const PUT = handler(async (req: Request) => {
  await requireRole("manager");
  const body = (await req.json()) as { defaults?: Record<string, string> };
  const incoming = body.defaults ?? {};

  const next: VideoTypeDefaults = {};
  for (const [type, packName] of Object.entries(incoming)) {
    if (!VIDEO_TYPES.includes(type as VideoType)) {
      throw new ApiError(400, `${type} is not a video type`);
    }
    // Clearing an entry is legitimate: with none, the type falls back to the
    // first pack declaring it.
    if (!packName) continue;

    // stylePackPath throws a bare Error on a bad name, which would surface as
    // a 500; the name is user input here, so it is checked first.
    if (!STYLE_PACK_NAME_RE.test(packName)) throw new ApiError(400, `${packName} is not a style pack name`);
    const path = stylePackPath(packName);
    if (!existsSync(path)) throw new ApiError(400, `style pack ${packName} is not on disk`);
    let doc: StylePack;
    try {
      doc = JSON.parse(readFileSync(path, "utf8")) as StylePack;
    } catch {
      throw new ApiError(400, `style pack ${packName} is not readable JSON`);
    }
    if (doc.video_type && doc.video_type !== type) {
      throw new ApiError(
        400,
        `${packName} declares video_type ${doc.video_type}, so it cannot be the default for ${type}`
      );
    }
    next[type as VideoType] = packName;
  }

  const check = validateAgainst("video_type_defaults", { defaults: next });
  if (!check.ok) throw new ApiError(400, `video-type defaults invalid: ${check.errors.join("; ")}`);

  writeVideoTypeDefaults(next);
  return NextResponse.json({ defaults: next });
});
