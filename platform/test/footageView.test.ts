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
  assert.equal(photo.placed, true);
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
