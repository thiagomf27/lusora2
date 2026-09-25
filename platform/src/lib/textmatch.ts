/**
 * The comparison keys the compiler matches words by — a SUBSET of
 * the worker's compiler/textmatch.py, ported so the paste box can
 * locate a phrase in a script exactly the way the worker will.
 *
 * Ported: `fold` (case, diacritics, punctuation), the written/spoken
 * equivalents (`Dr.` = `doutor`), dash splitting and the currency skip in
 * `tokenize`. NOT ported: number runs ('oitenta por cento' = 80). Nothing on the
 * platform reads a number out of a phrase, and the one check that does — an
 * anchor's value against the number spoken — runs in the worker.
 *
 * Two implementations of one rule: change both. The shared expectation table
 * is contracts/fixtures/rules/edit_hints_rules.json.
 */

const NON_ALNUM = /[^a-z0-9]/g;
const SPLIT_CHARS = /[-–—/]+/;
const CURRENCY = /^(?:us|r|c|a|nz)?\$$/i;
const EDGE_PUNCT = /^[.,;:!?()[\]]+|[.,;:!?()[\]]+$/g;

/** Python's `unicodedata.normalize("NFKD")` + drop combining marks + keep a-z0-9. */
export function fold(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(NON_ALNUM, "");
}

const EQUIVALENTS: Record<string, string> = {
  dr: "@dr", doutor: "@dr", doctor: "@dr",
  dra: "@dra", doutora: "@dra",
  sr: "@sr", senhor: "@sr", mr: "@sr", mister: "@sr",
  sra: "@sra", senhora: "@sra", mrs: "@sra",
  prof: "@prof", professor: "@prof",
  vs: "@vs", versus: "@vs",
  etc: "@etc", etcetera: "@etc",
  km: "@km", quilometros: "@km", quilometro: "@km",
  kilometers: "@km", kilometres: "@km", kilometer: "@km",
  kg: "@kg", quilos: "@kg", quilogramas: "@kg", kilograms: "@kg",
};

/** The form two tokens are compared by. */
export function compareKey(word: string): string {
  const w = fold(word);
  return EQUIVALENTS[w] ?? w;
}

/** Comparable tokens, raw form preserved; dashes and slashes split. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    for (const part of raw.split(SPLIT_CHARS)) {
      if (CURRENCY.test(part.replace(EDGE_PUNCT, ""))) continue;
      if (fold(part)) out.push(part);
    }
  }
  return out;
}
