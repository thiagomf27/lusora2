import test from "node:test";
import assert from "node:assert/strict";
import { parseChain } from "../src/lib/llmChain.ts";

test("a comma-separated chain becomes its elements, trimmed", () => {
  assert.deepEqual(parseChain("claude_cli, gemini/gemini-2.5-flash ,deepseek"), [
    "claude_cli",
    "gemini/gemini-2.5-flash",
    "deepseek",
  ]);
});

test("a trailing comma mid-typing adds no empty element", () => {
  assert.deepEqual(parseChain("claude_cli,"), ["claude_cli"]);
  assert.deepEqual(parseChain("claude_cli,, gemini"), ["claude_cli", "gemini"]);
});

test("nothing typed is an empty chain, which the caller must not save", () => {
  assert.deepEqual(parseChain("  "), []);
});
