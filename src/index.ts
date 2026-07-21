import * as core from "@actions/core";
import { extractCommand, readEventPayload } from "./event.js";
import { NotomateClient } from "./notomate-client.js";
import { buildAllowedToolNames, buildNotomateMcpServer } from "./mcp/server.js";
import { runAgent } from "./agent.js";

async function run(): Promise<void> {
  const anthropicApiKey = core.getInput("anthropic-api-key") || undefined;
  const claudeCodeOAuthToken = core.getInput("claude-code-oauth-token") || undefined;
  const notomateBaseUrl = core.getInput("notomate-base-url", { required: true });
  const notomateApiKey = core.getInput("notomate-api-key", { required: true });
  const triggerPhrase = core.getInput("trigger-phrase") || "@claude";
  const allowedToolsOverride = core.getInput("allowed-tools");
  const maxTurns = Number.parseInt(core.getInput("max-turns") || "30", 10);

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
  const { server, tools } = buildNotomateMcpServer(client, {
    workspaceId: payload.workspace.id,
    noteId: comment.note_id,
  });

  const allowedTools = allowedToolsOverride
    ? buildAllowedToolNames(allowedToolsOverride.split(",").map((s) => s.trim()).filter(Boolean))
    : buildAllowedToolNames(tools.map((t) => t.name));

  const systemContext = payload.note
    ? `Context: this comment is on note "${payload.note.title}" (id: ${payload.note.id}) in workspace "${payload.workspace.name}".`
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
