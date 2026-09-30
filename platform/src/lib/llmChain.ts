/**
 * D116 — an `llm` field typed as comma-separated text: `"claude_cli, gemini"`
 * -> `["claude_cli", "gemini"]`. Empty pieces (a trailing comma mid-typing,
 * a double comma) are dropped; an empty result means "nothing valid yet", and
 * the caller keeps the last valid chain rather than saving `[]`, which the
 * schema refuses (`minItems: 1`).
 */
export function parseChain(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
