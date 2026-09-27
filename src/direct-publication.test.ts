import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePublicationOptions, publishDirectResult, DIRECT_EXCLUDED_TOOLS } from "./direct-publication.js";
import { buildNotomateMcpServer } from "./mcp/server.js";
import { NotomateClient } from "./notomate-client.js";

test("publication defaults and explicit overrides are validated", () => {
  assert.deepEqual(parsePublicationOptions(), { publish: true, visibility: "private" });
  for (const visibility of ["private", "public", "workspace"]) {
    assert.deepEqual(parsePublicationOptions("false", visibility), { publish: false, visibility });
  }
  assert.throws(() => parsePublicationOptions("yes"), /publish-note/);
  assert.throws(() => parsePublicationOptions("true", "team"), /note-visibility/);
});

test("publishes source failure explanations once with configured visibility", async () => {
  for (const visibility of ["private", "public", "workspace"]) {
    const calls: unknown[] = [];
    const client = { createNote: async (...args: unknown[]) => { calls.push(args); return { id: "note-1" }; } };
    const id = await publishDirectResult(client, "ws-1", "# 美國新聞摘要\n\n新聞服務已停用。", parsePublicationOptions("true", visibility));
    assert.equal(id, "note-1");
    assert.deepEqual(calls, [["ws-1", { title: "美國新聞摘要", content: "新聞服務已停用。", visibility }]]);
  }
});

test("disabled publication never calls the API", async () => {
  const client = { createNote: async () => { throw new Error("must not call"); } };
  assert.equal(await publishDirectResult(client, "ws", "result", parsePublicationOptions("false")), undefined);
});

test("plain responses are retained and publication errors propagate", async () => {
  const options = parsePublicationOptions();
  await publishDirectResult({ createNote: async (_ws, body) => {
    assert.equal(body.content, "Source unavailable");
    assert.equal(body.title, "Workflow result");
    return { id: "n" };
  } }, "ws", "Source unavailable", options);
  await assert.rejects(publishDirectResult({ createNote: async () => { throw new Error("HTTP 403"); } }, "ws", "text", options), /403/);
  await assert.rejects(publishDirectResult({ createNote: async () => ({}) }, "ws", "text", options), /no note id/);
  await assert.rejects(publishDirectResult({ createNote: async () => ({ id: "n" }) }, "ws", "  ", options), /no content/);
});

test("direct runs remove creation and visibility tools even in bypass mode; other runs retain them", () => {
  const client = new NotomateClient("http://localhost", "test");
  const direct = buildNotomateMcpServer(client, { workspaceId: "ws" }, {}, DIRECT_EXCLUDED_TOOLS);
  const normal = buildNotomateMcpServer(client, { workspaceId: "ws" }, {});
  for (const name of DIRECT_EXCLUDED_TOOLS) {
    assert.equal(direct.tools.some(t => t.name === name), false);
    assert.equal(normal.tools.some(t => t.name === name), true);
  }
});
