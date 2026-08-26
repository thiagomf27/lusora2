"use client";
/**
 * The still an overlay preview stands on.
 *
 * A synthesized gradient answers "does this component draw", not "does this
 * read over the shot it will actually sit on" — which is the only question that
 * matters for a theme whose overlays are bare type over footage. So the screens
 * let you drop a real frame in.
 *
 * It never leaves the browser. There is no upload endpoint, no storage bucket
 * and nothing to clean up: the file is decoded, downscaled and kept as a data
 * URI in localStorage, which is the right shape for a per-person preview aid
 * that no render ever consumes.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "lusora.overlayBackdrop";

/**
 * Decode, downscale and re-encode a picked file.
 *
 * Downscaled because the previews are 1280 wide and a 12-megapixel phone photo
 * as a base64 PNG is several megabytes of localStorage for pixels nothing can
 * show. JPEG for the same reason — this is a backdrop, not an asset.
 */
export async function fileToBackdrop(file: File, maxWidth = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("that file could not be decoded as an image"));
      el.src = url;
    });
    const scale = Math.min(1, maxWidth / Math.max(1, img.naturalWidth));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this browser gave no 2d canvas context");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The stored backdrop, shared by every screen that previews an overlay — drop a
 * frame on the Overlays screen and the Look grid is standing on it too.
 *
 * Read in an effect rather than in the initial state: this runs during a Next
 * prerender where there is no `localStorage`, and a first paint that disagrees
 * with the client is a hydration mismatch.
 */
export function useBackdrop(): {
  image: string | null;
  setImage: (next: string | null) => void;
} {
  const [image, set] = useState<string | null>(null);

  useEffect(() => {
    try {
      set(localStorage.getItem(KEY));
    } catch {
      // private mode, or site data blocked: the preview just has no backdrop
    }
  }, []);

  const setImage = useCallback((next: string | null) => {
    set(next);
    try {
      if (next) localStorage.setItem(KEY, next);
      else localStorage.removeItem(KEY);
    } catch {
      // over quota or blocked — keep it for this session rather than failing
    }
  }, []);

  return { image, setImage };
}
