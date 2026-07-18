/**
 * Config snapshot merge (Core Principle 7): channel config + per-video
 * overrides deep-merge ONCE at enqueue. `chain` lists (and all arrays)
 * replace wholesale — no list merging.
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown> | undefined | null
): T {
  if (!override) return structuredClone(base);
  const out: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      out[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = structuredClone(value);
    }
  }
  return out as T;
}
