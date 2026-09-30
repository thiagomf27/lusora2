/**
 * D105 — the footage review behind a footage gate: each judged shot with its
 * best candidates and a link a person can open (the YouTube moment, the
 * photo's page, the stock page), the placed one marked.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root = "";
before(() => {
  root = mkdtempSync(join(tmpdir(), "footage-"));
  process.env.VIDEOS_ROOT = root;
});
after(() => rmSync(root, { recursive: true, force: true }));

function write(id: string, rel: string, body: unknown) {
  mkdirSync(join(root, id, rel, ".."), { recursive: true });
  writeFileSync(join(root, id, rel), typeof body === "string" ? body : JSON.stringify(body));
}

test("each shot lists its best candidates with a link, the placed one marked", async () => {
  const { footageView } = await import("../src/lib/footageView.ts");
  const id = "vid_f";
  write(id, "shot_picks.json", {
    enabled: true, unjudged: ["v9"],
    items: {
      v_b2: { beat_id: "b2", candidates: [
        { source: "youtube", provider: "youtube", id: "abc#3", rating: 4, desc: "steam vent", query: "q" },
        { source: "archive", provider: "commons", id: "commons:7", rating: 3, desc: "old photo", query: "q" },
        { source: "stock", provider: "pexels", id: "555", rating: 2, desc: "suburb", query: "q", thumb: "https://img/555.jpg" },
      ] },
      v_b1: { beat_id: "b1", candidates: [
        { source: "stock", provider: "pexels", id: "9", rating: 2, desc: "sunny street", query: "q" },
      ] },
    },
  });
  write(id, "footage.json", {
    videos: [{ id: "abc", url: "https://www.youtube.com/watch?v=abc", shots: [{ n: 3, start: 41.7, dur: 5, thumb: "footage/thumbs/abc_03.jpg" }] }],
    photos: [{ id: "commons:7", page: "https://commons.wikimedia.org/wiki/File:X.jpg", thumb: "https://upload/x.jpg" }],
  });
  write(id, "footage/thumbs/abc_03.jpg", "jpg");
  write(id, "beats.json", { beats: [{ id: "b1", script_text: "In a quiet corner." }, { id: "b2", script_text: "Steam still rises." }] });
  write(id, "edit_plan.json", { tracks: { visual: [
    { id: "v_b1", hook: true, asset: { source: "stock", id: "9" } },
    { id: "v_b2", asset: { source: "archive", id: "commons:7" } },
  ] } });
  write(id, "cfg.json", { source_policy: { visual: { pick: { min_rating: 3 } } } });
  write(id, "sheets/sheet_01.jpg", "jpg");

  const view = footageView(id)!;
  assert.deepEqual(view.rows.map((r) => r.item_id), ["v_b1", "v_b2"], "in plan order");
  assert.equal(view.rows[0].hook, true);
  const [yt, photo, stock] = view.rows[1].candidates;
  assert.equal(yt.link, "https://www.youtube.com/watch?v=abc&t=41s");
  assert.equal(yt.thumb, "/api/videos/vid_f/files/footage/thumbs/abc_03.jpg");
  assert.equal(photo.link, "https://commons.wikimedia.org/wiki/File:X.jpg");
  assert.equal(photo.used, true, "after resolve: what the plan placed");
  assert.equal(stock.link, "https://www.pexels.com/video/555/");
  assert.equal(stock.thumb, "https://img/555.jpg");
  assert.deepEqual(view.sheets, ["/api/videos/vid_f/files/sheets/sheet_01.jpg"]);
  assert.deepEqual(view.unjudged, ["v9"]);
});

test("a video without judged footage has no review", async () => {
  const { footageView } = await import("../src/lib/footageView.ts");
  write("vid_off", "shot_picks.json", { enabled: false, items: {} });
  assert.equal(footageView("vid_off"), null);
  assert.equal(footageView("vid_none"), null);
});

test("before the render it predicts each shot's pick: best 3+, not taken earlier, a choice first", async () => {
  const { footageView } = await import("../src/lib/footageView.ts");
  const id = "vid_pred";
  const cand = (cid: string, rating: number) => ({ source: "stock", provider: "pexels", id: cid, rating, query: "q" });
  write(id, "shot_picks.json", { enabled: true, items: {
    v_b1_0: { beat_id: "b1", candidates: [cand("A", 5), cand("B", 4)] },
    v_b1_1: { beat_id: "b1", candidates: [cand("A", 5), cand("C", 3)] },
    v_b2: { beat_id: "b2", candidates: [cand("D", 2), cand("E", 1)] },
    v_b3: { beat_id: "b3", candidates: [cand("F", 1)] },
  } });
  write(id, "beats.json", { beats: [{ id: "b1", script_text: "One." }, { id: "b2", script_text: "Two." }, { id: "b3", script_text: "Three." }] });
  write(id, "edit_plan.json", { tracks: { visual: [
    { id: "v_b1_0", beat_id: "b1", start_s: 0, end_s: 2, asset: {} },
    { id: "v_b1_1", beat_id: "b1", start_s: 2, end_s: 4, asset: {} },
    { id: "v_b2", beat_id: "b2", start_s: 4, end_s: 7, asset: {} },
    { id: "v_b3", beat_id: "b3", start_s: 7, end_s: 9, asset: {} },
  ] } });
  const used = (v: any) => v.rows.map((r: any) => r.candidates.find((c: any) => c.used)?.id ?? null);
  let view = footageView(id)!;
  assert.equal(view.resolved, false);
  assert.deepEqual(used(view), ["A", "C", "D", null], "A is taken by shot 1; D is the last resort; F (a 1) never");
  assert.deepEqual(view.rows.map((r: any) => [r.shot, r.shots_in_beat]), [[1, 2], [2, 2], [1, 1], [1, 1]]);
  assert.deepEqual(view.rows.map((r: any) => r.covered), [true, true, false, false]);

  write(id, "footage_choices.json", { choices: { v_b1_0: { source: "stock", id: "B" } } });
  view = footageView(id)!;
  assert.deepEqual(used(view), ["B", "A", "D", null], "the choice goes first and frees A for shot 2");
  assert.equal(view.rows[0].candidates.find((c: any) => c.id === "B")?.chosen, true);
});
