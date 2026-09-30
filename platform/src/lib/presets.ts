/**
 * Channel presets (D119) on the platform side. The merge and forbidden-key
 * rules live in `@lusora/contracts` so `validate:schemas` checks presets with
 * the very same code; this adds reading them from `contracts/presets/`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PresetOption } from "@lusora/contracts";

export {
  FORBIDDEN_PRESET_KEYS,
  applyPreset,
  deepMerge,
  forbiddenPresetKeys,
} from "@lusora/contracts";
export type { PresetOption } from "@lusora/contracts";

/** Every readable preset in `<repo>/contracts/presets`, by name. A file that
 *  is not valid JSON is skipped: `validate:schemas` is where it is reported. */
export function listPresets(repo: string): PresetOption[] {
  const dir = join(repo, "contracts", "presets");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((file) => {
      try {
        const preset = JSON.parse(readFileSync(join(dir, file), "utf8"));
        return [{ name: file.replace(/\.json$/, ""), description: String(preset.description ?? ""), preset }];
      } catch {
        return [];
      }
    });
}
