import test from "node:test";
import assert from "node:assert/strict";
import {
  compose,
  listPrompts,
  loadRoles,
  render,
  resolvePrompt,
  usedVariables,
  validatePrompt,
  weldedText,
  type PromptDoc,
} from "../src/lib/prompts.ts";

/**
 * The renderer is duplicated in Python (lusora_contracts.prompts) because the
 * worker and the platform both compose prompts. These cases are the contract
 * between the two implementations — worker/tests/test_prompts.py asserts the
 * same behaviour on the same inputs.
 */
test("render substitutes variables and drops unknown ones", () => {
  assert.equal(render("Hello {{name}}!", { name: "world" }), "Hello world!");
  assert.equal(render("Hello {{missing}}!", {}), "Hello !");
});

test("optional blocks take their label with them", () => {
  const t = "{{#rules}}RULES: {{rules}}\n{{/rules}}end";
  assert.equal(render(t, { rules: "be brief" }), "RULES: be brief\nend");
  assert.equal(render(t, { rules: "" }), "end");
  assert.equal(render(t, {}), "end");
});

test("empty arrays and false count as absent", () => {
  assert.equal(render("{{#a}}x{{/a}}", { a: [] }), "");
  assert.equal(render("{{#a}}x{{/a}}", { a: false }), "");
  assert.equal(render("{{#a}}x{{/a}}", { a: ["one"] }), "x");
});

test("compose appends the welded half to the editable half", () => {
  const doc = { system: "VOICE: grave.", user: "Write about {{title}}." };
  const { system, user } = compose("script", doc, { title: "Ships", language: "en-US" });

  assert.match(system, /^VOICE: grave\./);
  // the contract half is present, and carries its own variables
  assert.match(system, /Output ONLY the narration text/);
  assert.match(system, /Write the ENTIRE script in en-US\./);
  assert.equal(user, "Write about Ships.");
});

test("welded text is never empty for a role that declares it", () => {
  for (const role of ["script", "planner", "spine", "chat"] as const) {
    assert.notEqual(weldedText(role, "system").trim(), "", `${role} system`);
  }
  assert.notEqual(weldedText("planner", "user").trim(), "");
  assert.equal(weldedText("script", "user"), "");
});

test("usedVariables sees block markers as well as substitutions", () => {
  assert.deepEqual(usedVariables("{{#a}}{{b}}{{/a}}").sort(), ["a", "b"]);
});

test("every shipped prompt is valid", () => {
  for (const doc of listPrompts()) {
    assert.deepEqual(validatePrompt(doc), [], `${doc.role}/${doc.name}`);
  }
});

test("validatePrompt rejects an unknown variable", () => {
  const doc: PromptDoc = {
    name: "x",
    role: "script",
    system: "Write in {{langauge}}.", // typo
  };
  const errors = validatePrompt(doc);
  assert.ok(errors.some((e) => /unknown variable \{\{langauge\}\}/.test(e)), errors.join("; "));
});

test("validatePrompt rejects a prompt that drops a required variable", () => {
  // {{script}} is required for the planner and lives in the editable half; a
  // prompt without it would ask the model to segment nothing.
  const doc: PromptDoc = { name: "x", role: "planner", system: "Plan beats.", user: "Go." };
  assert.ok(validatePrompt(doc).some((e) => /required variable \{\{script\}\}/.test(e)));
});

test("roles.json declares the three bounded agents, plus the planner's spine phase", () => {
  // Four prompt roles, still three agents (D2): `spine` is phase 1 of the beat
  // planner on a long script (D52) and shares planner.llm/model.
  assert.deepEqual(Object.keys(loadRoles()).sort(), ["chat", "planner", "script", "spine"]);
});

test("the spine's channel layer sits under planner.spine", () => {
  const cfg = { channel_id: "C1", planner: { spine: { prompt: "default" } } };
  const result = resolvePrompt(cfg, "spine");
  assert.ok("resolved" in result, JSON.stringify(result));
  assert.equal(result.resolved.name, "default");
  assert.equal(result.resolved.source, "channel");
});

// ---------- resolution ladder (D44) ----------

const cfgWith = (extra: Record<string, unknown>) => ({
  channel_id: "C1",
  style_pack_doc: { name: "doc-slow", script: { prompt: "doc-grave" } },
  ...extra,
});

test("per-video override wins over channel and style pack", () => {
  const out = resolvePrompt(cfgWith({ script: { prompt: "default" } }), "script", {
    script: { prompt: "doc-grave" },
  });
  assert.ok("resolved" in out);
  assert.equal(out.resolved.name, "doc-grave");
  assert.equal(out.resolved.source, "video");
});

test("channel wins over the style pack", () => {
  const out = resolvePrompt(cfgWith({ script: { prompt: "default" } }), "script");
  assert.ok("resolved" in out);
  assert.equal(out.resolved.name, "default");
  assert.equal(out.resolved.source, "channel");
});

test("the style pack is layer 3", () => {
  const out = resolvePrompt(cfgWith({}), "script");
  assert.ok("resolved" in out);
  assert.equal(out.resolved.name, "doc-grave");
  assert.equal(out.resolved.source, "style_pack");
});

test("default is the floor, and only script reads the style pack layer", () => {
  const script = resolvePrompt({ channel_id: "C1" }, "script");
  assert.ok("resolved" in script);
  assert.equal(script.resolved.source, "default");

  // the style pack's script.prompt must not leak into the planner's resolution
  const planner = resolvePrompt(cfgWith({}), "planner");
  assert.ok("resolved" in planner);
  assert.equal(planner.resolved.name, "default");
  assert.equal(planner.resolved.source, "default");
});

test("a named prompt that does not exist is a config error, not a silent fallback", () => {
  const out = resolvePrompt(cfgWith({ script: { prompt: "no-such-prompt" } }), "script");
  assert.ok("problem" in out);
  assert.match(out.problem, /no-such-prompt/);
});

test("the snapshot carries text, not a name, and never the welded half", () => {
  const out = resolvePrompt(cfgWith({}), "script");
  assert.ok("resolved" in out);
  assert.ok(out.resolved.system.length > 0);
  assert.ok(!out.resolved.system.includes("Output ONLY the narration text"));
});
