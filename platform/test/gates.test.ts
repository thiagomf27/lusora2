/**
 * D105 — which gate the approve button clears. A requested gate (thin footage)
 * stops an AUTO video too, so "the gate it is stopped at" can no longer be
 * "the first declared gate without an approval": on an auto video the declared
 * gates never fired, and approving one of them would leave the video stuck.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root = "";
before(() => {
  root = mkdtempSync(join(tmpdir(), "gates-"));
  process.env.VIDEOS_ROOT = root;
});
after(() => rmSync(root, { recursive: true, force: true }));

const manifest = {
  name: "documentary",
  version: "1.4",
  stages: [
    { name: "plan_beats", human_approval_on_review_mode: true },
    { name: "footage_check" },
    { name: "pick_shots", human_approval_on_review_mode: true },
  ],
};

function video(id: string, policy?: string) {
  mkdirSync(join(root, id), { recursive: true });
  return { id, cfg: { checkpoint_policy: policy, pipeline_doc: manifest } };
}

function file(id: string, rel: string, body: object = {}) {
  mkdirSync(join(root, id, rel, ".."), { recursive: true });
  writeFileSync(join(root, id, rel), JSON.stringify(body));
}

test("an auto video stopped by a requested gate is waiting at THAT gate", async () => {
  const { pendingGate, gateReason, gatedStages } = await import("../src/lib/gates.ts");
  const v = video("auto1", "auto");
  file("auto1", "gate_requests/footage_check.json", { reason: "thin topic: only 3 of 11 subjects" });
  assert.equal(pendingGate(v), "footage_check", "not plan_beats, which never fired on an auto video");
  assert.equal(gateReason(v, "footage_check"), "thin topic: only 3 of 11 subjects");
  assert.deepEqual(gatedStages(v), ["plan_beats", "footage_check", "pick_shots"]);
});

test("a review-mode video walks its declared gates, and a request joins them in order", async () => {
  const { pendingGate } = await import("../src/lib/gates.ts");
  const v = video("guided1", "guided");
  assert.equal(pendingGate(v), "plan_beats");
  file("guided1", "approvals/plan_beats.json");
  file("guided1", "gate_requests/footage_check.json", { reason: "thin" });
  assert.equal(pendingGate(v), "footage_check");
  file("guided1", "approvals/footage_check.json");
  assert.equal(pendingGate(v), "pick_shots", "review mode always stops after the judge");
});

test("an auto video with no request has no gate", async () => {
  const { pendingGate, gateReason } = await import("../src/lib/gates.ts");
  const v = video("auto2");
  assert.equal(pendingGate(v), null);
  assert.equal(gateReason(v, "pick_shots"), null);
});
