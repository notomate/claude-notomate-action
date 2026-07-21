import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCommand } from "./event.js";

test("extractCommand finds the phrase and returns trimmed remainder", () => {
  assert.equal(extractCommand("@claude list my notes", "@claude"), "list my notes");
});

test("extractCommand is case-insensitive", () => {
  assert.equal(extractCommand("Hey @Claude, summarize this", "@claude"), ", summarize this");
});

test("extractCommand returns null when the phrase is absent", () => {
  assert.equal(extractCommand("just a regular comment", "@claude"), null);
});

test("extractCommand returns null when nothing follows the phrase", () => {
  assert.equal(extractCommand("@claude", "@claude"), null);
  assert.equal(extractCommand("@claude   ", "@claude"), null);
});

test("extractCommand finds the phrase mid-sentence", () => {
  assert.equal(
    extractCommand("thanks for the note, @claude can you pin it?", "@claude"),
    "can you pin it?",
  );
});

test("extractCommand recognizes a notomate mention token for the trigger phrase", () => {
  assert.equal(
    extractCommand(
      "@[claude](019f84fd-b262-7806-a10b-36f8acfc50a3) \n幫我摘要這個筆記",
      "@claude",
    ),
    "幫我摘要這個筆記",
  );
});

test("extractCommand ignores mention tokens for other members", () => {
  assert.equal(
    extractCommand("@[Jane Doe](2f6a) can you take a look?", "@claude"),
    null,
  );
});

test("extractCommand returns null for a mention token with nothing following it", () => {
  assert.equal(extractCommand("@[claude](019f84fd)", "@claude"), null);
  assert.equal(extractCommand("@[claude](019f84fd)   ", "@claude"), null);
});
