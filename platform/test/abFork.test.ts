import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FORK_RECORD,
  copyForkFiles,
  forkSnapshot,
  missingForkFiles,
  sameNarration,
  sha256File,
  snapshotDifferences,
  writeForkRecord,
} from "../src/lib/abFork.ts";
import { loadPipeline } from "../src/lib/pipelines.ts";

/**
 * The A/B fork (docs/05-roadmap/directed-edit-test.md, slice 5): one variable,
 * the pipeline, and the same narration files byte for byte.
 */
function manifest(name: string) {
  const loaded = loadPipeline(name);
  assert.ok(loaded.ok, loaded.ok ? "" : loaded.problem);
  return loaded.manifest;
}

const v3 = manifest("faceless_v3");
const directed = manifest("faceless_directed");
const source = {
  channel_id: "DIRECTED_TEST_01",
  style_pack: "directed-test",
  voice: { provider: "ai33", voice_id: "x" },
  look: { exclude: { components: ["FactCard"] } },
  pipeline: v3.name,
  pipeline_doc: v3,
};

test("the fork swaps the pipeline and nothing else", () => {
  const fork = forkSnapshot(source, directed);
  assert.equal(fork.pipeline, "faceless_directed");
  assert.equal((fork.pipeline_doc as { name: string }).name, "faceless_directed");
  assert.deepEqual(snapshotDifferences(source, fork), []);
  assert.equal(source.pipeline, "faceless_v3", "the source snapshot is not mutated");
});

test("a difference beyond the pipeline is named", () => {
  const fork = forkSnapshot(source, directed);
  (fork.look as { exclude: { components: string[] } }).exclude.components.push("BarChart");
  fork.theme = "paper-print";
  assert.deepEqual(snapshotDifferences(source, fork), ["look", "theme"]);
});

test("key order is not a difference (JSONB reorders keys)", () => {
  const reordered = Object.fromEntries(Object.entries(source).reverse());
  reordered.voice = { voice_id: "x", provider: "ai33" };
  assert.deepEqual(snapshotDifferences(source, reordered), []);
});

test("the same narration ignores line endings and the trailing newline only", () => {
  assert.ok(sameNarration("Uma frase.\r\nOutra.\n", "Uma frase.\nOutra."));
  assert.ok(!sameNarration("Uma frase. Outra.", "Uma frase.  Outra."));
  assert.ok(!sameNarration("Uma frase.", "Uma Frase."));
});

test("the shared files are copied byte for byte, over anything written before", () => {
  const root = mkdtempSync(join(tmpdir(), "abfork-"));
  const from = join(root, "a");
  const to = join(root, "b");
  mkdirSync(from);
  mkdirSync(to);
  writeFileSync(join(from, "script.txt"), "Roteiro.");
  writeFileSync(join(from, "audio.mp3"), Buffer.from([1, 2, 3]));
  writeFileSync(join(from, "subtitles.srt"), "1\n00:00:00,000 --> 00:00:01,000\nRoteiro.\n");
  writeFileSync(join(from, "tts_timings.json"), "{}");
  writeFileSync(join(from, "beats.json"), "{}");
  writeFileSync(join(to, "script.txt"), "Roteiro.\n"); // what a paste writes

  const hashes = copyForkFiles(from, to);
  assert.deepEqual(Object.keys(hashes), ["script.txt", "audio.mp3", "subtitles.srt", "tts_timings.json"]);
  for (const [file, hash] of Object.entries(hashes)) assert.equal(sha256File(join(to, file)), hash);
  assert.equal(readFileSync(join(to, "script.txt"), "utf8"), "Roteiro.");
  assert.ok(!existsSync(join(to, "beats.json")), "nothing downstream is shared");

  writeForkRecord(to, { from: "vid_a", from_pipeline: "faceless_v3", pipeline: "faceless_directed", files: hashes, created_at: "t" });
  assert.equal(JSON.parse(readFileSync(join(to, FORK_RECORD), "utf8")).from, "vid_a");
});

test("timings are optional; audio and subtitles are not", () => {
  const root = mkdtempSync(join(tmpdir(), "abfork-"));
  writeFileSync(join(root, "script.txt"), "x");
  writeFileSync(join(root, "audio.mp3"), "x");
  assert.deepEqual(missingForkFiles(root), ["subtitles.srt"]);
  assert.throws(() => copyForkFiles(root, join(root, "b")), /subtitles\.srt/);
  writeFileSync(join(root, "subtitles.srt"), "x");
  assert.deepEqual(Object.keys(copyForkFiles(root, join(root, "b"))), ["script.txt", "audio.mp3", "subtitles.srt"]);
});
