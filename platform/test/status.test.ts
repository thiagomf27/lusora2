import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, VIDEO_STATUS_TRANSITIONS } from "@lusora/contracts";

test("status transitions match the queue flow", () => {
  assert.ok(canTransition("admin", "draft", "queued"));
  assert.ok(canTransition("manager", "error", "queued"));
  assert.ok(!canTransition("editor", "draft", "queued"));
  assert.ok(canTransition("editor", "in_review", "approved"));
  assert.ok(!canTransition("editor", "queued", "producing"));
  assert.deepEqual(VIDEO_STATUS_TRANSITIONS.posted, []);
});
