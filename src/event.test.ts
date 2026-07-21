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
