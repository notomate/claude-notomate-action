import * as core from "@actions/core";
import type { CollabConfig } from "./collab-client.js";
import { extractCommand, readEventPayload } from "./event.js";
import { NotomateClient } from "./notomate-client.js";
import { buildAllowedToolNames, buildNotomateMcpServer } from "./mcp/server.js";
import { runAgent } from "./agent.js";

// Composite actions can't rely on @actions/core's default INPUT_<NAME> lookup for
// kebab-case inputs: the runner sets them as literal hyphenated env vars, which bash
// can't export/pass through cleanly, so the composite step maps them to INPUT_<NAME>
// with underscores instead. Read those directly rather than via core.getInput().
function getInput(name: string, options?: { required?: boolean }): string {
  const envName = `INPUT_${name.replace(/-/g, "_").toUpperCase()}`;
  const value = (process.env[envName] || "").trim();
  if (options?.required && !value) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return value;
}

async function run(): Promise<void> {
  const anthropicApiKey = getInput("anthropic-api-key") || undefined;
  const claudeCodeOAuthToken = getInput("claude-code-oauth-token") || undefined;
  const notomateBaseUrl = getInput("notomate-base-url", { required: true });
  const notomateApiKey = getInput("notomate-api-key", { required: true });
  const notomateCollabUrl = getInput("notomate-collab-url", { required: true });
  const notomateAppSecret = getInput("notomate-app-secret", { required: true });
  const notomateBotUserId = getInput("notomate-bot-user-id", { required: true });
  const triggerPhrase = getInput("trigger-phrase") || "@claude";
  const allowedToolsOverride = getInput("allowed-tools");
  const maxTurns = Number.parseInt(getInput("max-turns") || "30", 10);

  if (!anthropicApiKey && !claudeCodeOAuthToken) {
    core.setFailed(
      "Either anthropic-api-key or claude-code-oauth-token must be provided.",
    );
    return;
  }

  const payload = readEventPayload();

  if (payload.event !== "comment.created") {
    core.info(`Ignoring event of type "${payload.event}" (only comment.created is handled).`);
    core.setOutput("conclusion", "skipped");
    return;
  }

  const comment = payload.comment;
  if (!comment) {
    core.info("Event payload has no comment field; nothing to do.");
    core.setOutput("conclusion", "skipped");
    return;
  }

  const command = extractCommand(comment.body, triggerPhrase);
  if (!command) {
    core.info(`Comment does not contain trigger phrase "${triggerPhrase}"; skipping.`);
    core.setOutput("conclusion", "skipped");
    return;
  }

  const client = new NotomateClient(notomateBaseUrl, notomateApiKey);
  const collab: CollabConfig = {
    url: notomateCollabUrl,
    appSecret: notomateAppSecret,
    botUserId: notomateBotUserId,
  };
  const { server, tools } = buildNotomateMcpServer(
    client,
    { workspaceId: payload.workspace.id, noteId: comment.note_id },
    collab,
  );

  const allowedTools = allowedToolsOverride
    ? buildAllowedToolNames(allowedToolsOverride.split(",").map((s) => s.trim()).filter(Boolean))
    : buildAllowedToolNames(tools.map((t) => t.name));

  const systemContext = payload.note
    ? `Context: this comment is on note "${payload.note.title}" (id: ${payload.note.id}) in workspace "${payload.workspace.name}".\n` +
      `Note content (raw TipTap JSON, as stored by notomate):\n${payload.note.content}`
    : `Context: this comment is on note id ${comment.note_id} in workspace "${payload.workspace.name}".`;

  try {
    const { replyText, isError } = await runAgent({
      credentials: { anthropicApiKey, claudeCodeOAuthToken },
      prompt: command,
      systemContext,
      mcpServer: server,
      allowedTools,
      maxTurns,
    });

    const reply = await client.createComment(payload.workspace.id, comment.note_id, {
      body: replyText,
      thread_id: comment.thread_id,
    });

    core.setOutput("comment-id", reply.id);
    core.setOutput("conclusion", isError ? "failure" : "success");
    if (isError) {
      core.setFailed("Agent run completed with an error.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.error(`claude-notomate-action failed: ${message}`);

    try {
      const errorReply = await client.createComment(payload.workspace.id, comment.note_id, {
        body: `Sorry, I ran into an error and couldn't complete this request: ${message}`,
        thread_id: comment.thread_id,
      });
      core.setOutput("comment-id", errorReply.id);
    } catch (replyError) {
      core.error(
        `Also failed to post an error reply: ${
          replyError instanceof Error ? replyError.message : String(replyError)
        }`,
      );
    }

    core.setOutput("conclusion", "failure");
    core.setFailed(message);
  }
}

run();
