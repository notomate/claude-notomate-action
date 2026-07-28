import * as core from "@actions/core";
import { deriveCollabWsOrigin, type PartialCollabConfig } from "./collab-client.js";
import { extractCommand, readEventPayload, type EventPayload } from "./event.js";
import { NotomateClient } from "./notomate-client.js";
import { buildAllowedToolNames, buildNotomateMcpServer } from "./mcp/server.js";
import { type DefaultContext } from "./mcp/context.js";
import { runAgent, type AgentCredentials } from "./agent.js";

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

/**
 * Shared trigger-phrase-detected -> run agent -> post reply -> set outputs
 * flow, used by both the comment and message event handlers below. Errors
 * during the agent run are caught and posted back as a reply (rather than
 * just failing the action) so the person who triggered it sees why nothing
 * useful happened, mirroring the original comment-only behavior.
 */
async function runTriggerAndReply(params: {
  credentials: AgentCredentials;
  command: string;
  systemContext: string;
  mcpServer: Parameters<typeof runAgent>[0]["mcpServer"];
  allowedTools: string[];
  maxTurns: number;
  outputKey: string;
  postReply: (body: string) => Promise<{ id: string }>;
}): Promise<void> {
  const { credentials, command, systemContext, mcpServer, allowedTools, maxTurns, outputKey, postReply } = params;

  try {
    const { replyText, isError } = await runAgent({
      credentials,
      prompt: command,
      systemContext,
      mcpServer,
      allowedTools,
      maxTurns,
    });

    const reply = await postReply(replyText);

    core.setOutput(outputKey, reply.id);
    core.setOutput("conclusion", isError ? "failure" : "success");
    if (isError) {
      core.setFailed("Agent run completed with an error.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.error(`claude-notomate-action failed: ${message}`);

    try {
      const errorReply = await postReply(
        `Sorry, I ran into an error and couldn't complete this request: ${message}`,
      );
      core.setOutput(outputKey, errorReply.id);
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

async function handleComment(
  payload: EventPayload,
  client: NotomateClient,
  collab: PartialCollabConfig,
  credentials: AgentCredentials,
  triggerPhrase: string,
  allowedToolsOverride: string,
  maxTurns: number,
): Promise<void> {
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

  const ctx: DefaultContext = { workspaceId: payload.workspace.id, noteId: comment.note_id };
  const { server, tools } = buildNotomateMcpServer(client, ctx, collab);

  const allowedTools = allowedToolsOverride
    ? buildAllowedToolNames(allowedToolsOverride.split(",").map((s) => s.trim()).filter(Boolean))
    : buildAllowedToolNames(tools.map((t) => t.name));

  const systemContext = payload.note
    ? `Context: this comment is on note "${payload.note.title}" (id: ${payload.note.id}) in workspace "${payload.workspace.name}".\n` +
      `Note content (raw TipTap JSON, as stored by notomate):\n${payload.note.content}`
    : `Context: this comment is on note id ${comment.note_id} in workspace "${payload.workspace.name}".`;

  await runTriggerAndReply({
    credentials,
    command,
    systemContext,
    mcpServer: server,
    allowedTools,
    maxTurns,
    outputKey: "comment-id",
    postReply: (body) =>
      client.createComment(payload.workspace.id, comment.note_id, {
        body,
        thread_id: comment.thread_id,
      }),
  });
}

async function handleMessage(
  payload: EventPayload,
  client: NotomateClient,
  collab: PartialCollabConfig,
  credentials: AgentCredentials,
  triggerPhrase: string,
  allowedToolsOverride: string,
  maxTurns: number,
): Promise<void> {
  const message = payload.message;
  if (!message) {
    core.info("Event payload has no message field; nothing to do.");
    core.setOutput("conclusion", "skipped");
    return;
  }

  const command = extractCommand(message.body, triggerPhrase);
  if (!command) {
    core.info(`Message does not contain trigger phrase "${triggerPhrase}"; skipping.`);
    core.setOutput("conclusion", "skipped");
    return;
  }

  const ctx: DefaultContext = { workspaceId: payload.workspace.id, channelId: message.channel_id };
  const { server, tools } = buildNotomateMcpServer(client, ctx, collab);

  const allowedTools = allowedToolsOverride
    ? buildAllowedToolNames(allowedToolsOverride.split(",").map((s) => s.trim()).filter(Boolean))
    : buildAllowedToolNames(tools.map((t) => t.name));

  const systemContext = payload.channel
    ? `Context: this message is in channel "${payload.channel.name}" (id: ${payload.channel.id}) in workspace "${payload.workspace.name}".`
    : `Context: this message is in channel id ${message.channel_id} in workspace "${payload.workspace.name}".`;

  await runTriggerAndReply({
    credentials,
    command,
    systemContext,
    mcpServer: server,
    allowedTools,
    maxTurns,
    outputKey: "message-id",
    postReply: (body) => client.createChannelMessage(payload.workspace.id, message.channel_id, { body }),
  });
}

async function run(): Promise<void> {
  const anthropicApiKey = getInput("anthropic-api-key") || undefined;
  const claudeCodeOAuthToken = getInput("claude-code-oauth-token") || undefined;
  const notomateBaseUrl = getInput("notomate-base-url", { required: true });
  const notomateApiKey = getInput("notomate-api-key", { required: true });
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
  const client = new NotomateClient(notomateBaseUrl, notomateApiKey);
  // update_note connects to the same origin notomate's own editor does for
  // collab (see notomate's web/src/hooks/use-note-collab.ts), so this is
  // derived from notomate-base-url rather than a separate input.
  const collab: PartialCollabConfig = {
    url: deriveCollabWsOrigin(notomateBaseUrl),
    apiKey: notomateApiKey,
  };
  const credentials: AgentCredentials = { anthropicApiKey, claudeCodeOAuthToken };

  switch (payload.event) {
    case "comment.created":
      await handleComment(payload, client, collab, credentials, triggerPhrase, allowedToolsOverride, maxTurns);
      return;
    case "message.created":
      await handleMessage(payload, client, collab, credentials, triggerPhrase, allowedToolsOverride, maxTurns);
      return;
    default:
      core.info(
        `Ignoring event of type "${payload.event}" (only comment.created and message.created are handled).`,
      );
      core.setOutput("conclusion", "skipped");
  }
}

run();
