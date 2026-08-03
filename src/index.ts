import * as core from "@actions/core";
import type { Socket } from "socket.io-client";
import { deriveCollabWsOrigin, type PartialCollabConfig } from "./collab-client.js";
import { extractCommand, readEventPayload, type EventPayload } from "./event.js";
import {
  connectChannelSocket,
  sendChannelMessage,
  updateChannelMessage,
  type ChannelSocketMessage,
} from "./messaging-client.js";
import { NotomateClient } from "./notomate-client.js";
import { buildAllowedToolNames, buildNotomateMcpServer } from "./mcp/server.js";
import { type DefaultContext } from "./mcp/context.js";
import { parseExternalMcpConfig, type ExternalMcpServerConfig } from "./mcp/external-config.js";
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
 * flow, used by the comment event handler below (the channel/room handler
 * has its own variant, runTriggeredChannelReply, since it edits a status
 * into its reply message as the agent runs instead of posting once at the
 * end). Errors during the agent run are caught and posted back as a reply
 * (rather than just failing the action) so the person who triggered it sees
 * why nothing useful happened.
 */
async function runTriggerAndReply(params: {
  credentials: AgentCredentials;
  command: string;
  systemContext: string;
  mcpServer: Parameters<typeof runAgent>[0]["mcpServer"];
  extraMcpServers: Record<string, ExternalMcpServerConfig>;
  allowedTools: string[];
  maxTurns: number;
  outputKey: string;
  postReply: (body: string) => Promise<{ id: string }>;
}): Promise<void> {
  const { credentials, command, systemContext, mcpServer, extraMcpServers, allowedTools, maxTurns, outputKey, postReply } = params;

  try {
    const { replyText, isError } = await runAgent({
      credentials,
      prompt: command,
      systemContext,
      mcpServer,
      extraMcpServers,
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
  extraMcpServers: Record<string, ExternalMcpServerConfig>,
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
    extraMcpServers,
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

/**
 * Runs the agent for triggers that aren't a comment or channel message --
 * e.g. a schedule or workflow_dispatch event -- so there's no message body to
 * extract a command from and nowhere to post a reply. Runs directPrompt as
 * the whole task instead, trusting the agent to use its notomate tools
 * (e.g. create_note) to produce whatever output the prompt asks for.
 */
async function handleDirectPrompt(
  payload: EventPayload,
  client: NotomateClient,
  collab: PartialCollabConfig,
  credentials: AgentCredentials,
  directPrompt: string,
  allowedToolsOverride: string,
  extraMcpServers: Record<string, ExternalMcpServerConfig>,
  maxTurns: number,
): Promise<void> {
  const ctx: DefaultContext = { workspaceId: payload.workspace.id };
  const { server, tools } = buildNotomateMcpServer(client, ctx, collab);

  const allowedTools = allowedToolsOverride
    ? buildAllowedToolNames(allowedToolsOverride.split(",").map((s) => s.trim()).filter(Boolean))
    : buildAllowedToolNames(tools.map((t) => t.name));

  const systemContext = `Context: this run was triggered directly (event: "${payload.event}"), not by a comment ` +
    `or channel message, in workspace "${payload.workspace.name}". There is nothing to reply to -- use your ` +
    `tools to produce whatever output the task asks for (e.g. creating a note).`;

  try {
    const { replyText, isError } = await runAgent({
      credentials,
      prompt: directPrompt,
      systemContext,
      mcpServer: server,
      extraMcpServers,
      allowedTools,
      maxTurns,
    });

    core.info(`Direct prompt run finished: ${replyText}`);
    core.setOutput("conclusion", isError ? "failure" : "success");
    if (isError) {
      core.setFailed("Agent run completed with an error.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.error(`claude-notomate-action failed: ${message}`);
    core.setOutput("conclusion", "failure");
    core.setFailed(message);
  }
}

const INITIAL_STATUS_BODY = "⏳ Claude is working on this…";

/**
 * Runs the agent for one @claude-tagged channel message and reflects
 * progress into a single reply message: posted immediately as a status
 * placeholder, edited with a running status line as the agent uses tools,
 * then edited one last time with the final answer (or an error). Returns
 * the reply message's id, or undefined if even the initial post failed.
 */
async function runTriggeredChannelReply(params: {
  credentials: AgentCredentials;
  command: string;
  systemContext: string;
  mcpServer: Parameters<typeof runAgent>[0]["mcpServer"];
  extraMcpServers: Record<string, ExternalMcpServerConfig>;
  allowedTools: string[];
  maxTurns: number;
  socket: Socket;
  /** Ids of messages this action itself has posted into the room, so its
   * own status/reply messages don't get mistaken for new triggers when
   * they echo back over the socket (see the "room" case below). */
  ownMessageIds: Set<string>;
}): Promise<string | undefined> {
  const { credentials, command, systemContext, mcpServer, extraMcpServers, allowedTools, maxTurns, socket, ownMessageIds } =
    params;

  let messageId: string | undefined;
  try {
    // Both the initial post and every edit below go over this action's own
    // socket connection (message:send / message:update), not the REST API,
    // so they show up for other room members the same way a real client's
    // messages do.
    const posted = await sendChannelMessage(socket, INITIAL_STATUS_BODY);
    messageId = posted.id;
    ownMessageIds.add(messageId);

    const { replyText, isError } = await runAgent({
      credentials,
      prompt: command,
      systemContext,
      mcpServer,
      extraMcpServers,
      allowedTools,
      maxTurns,
      onStatus: async (status) => {
        try {
          await updateChannelMessage(socket, messageId!, status);
        } catch (error) {
          core.warning(
            `[room] failed to post status update to message ${messageId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    });

    await updateChannelMessage(socket, messageId, replyText);
    if (isError) {
      core.error(`[room] agent run for reply message ${messageId} completed with an error.`);
    }
    return messageId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.error(`[room] failed to handle triggered message: ${message}`);
    if (messageId) {
      try {
        await updateChannelMessage(
          socket,
          messageId,
          `Sorry, I ran into an error and couldn't complete this request: ${message}`,
        );
      } catch (updateError) {
        core.error(
          `[room] also failed to post an error status: ${
            updateError instanceof Error ? updateError.message : String(updateError)
          }`,
        );
      }
    }
    return messageId;
  }
}

/**
 * Handles a channel.room_created event: joins the channel's room over
 * Socket.IO (notomate's real-time messaging transport) and stays connected,
 * responding to any @claude-tagged message posted while it's there, until
 * the room's online users drops to just this connection -- i.e. everyone
 * else has left -- at which point it disconnects and the action ends. This
 * replaces the old one-shot "reply to the message that triggered this run"
 * flow: the workflow engine now only dispatches once per room (on the
 * empty -> occupied transition), not once per message.
 */
async function handleRoomCreated(
  payload: EventPayload,
  client: NotomateClient,
  collab: PartialCollabConfig,
  credentials: AgentCredentials,
  triggerPhrase: string,
  allowedToolsOverride: string,
  extraMcpServers: Record<string, ExternalMcpServerConfig>,
  maxTurns: number,
  notomateBaseUrl: string,
  notomateApiKey: string,
): Promise<void> {
  const channel = payload.channel;
  if (!channel) {
    core.info("Event payload has no channel field; nothing to do.");
    core.setOutput("conclusion", "skipped");
    return;
  }

  const ctx: DefaultContext = { workspaceId: payload.workspace.id, channelId: channel.id };
  const { server, tools } = buildNotomateMcpServer(client, ctx, collab);

  const allowedTools = allowedToolsOverride
    ? buildAllowedToolNames(allowedToolsOverride.split(",").map((s) => s.trim()).filter(Boolean))
    : buildAllowedToolNames(tools.map((t) => t.name));

  const systemContext = `Context: this message is in channel "${channel.name}" (id: ${channel.id}) in workspace "${payload.workspace.name}".`;

  core.info(`[room] channel.room_created for channel:${channel.id} ("${channel.name}"); joining`);
  const socket: Socket = await connectChannelSocket({
    url: notomateBaseUrl,
    apiKey: notomateApiKey,
    channelId: channel.id,
  });

  const ownMessageIds = new Set<string>();
  const inFlight = new Set<Promise<void>>();
  let lastMessageId: string | undefined;

  await new Promise<void>((resolveRoom) => {
    let settled = false;
    const leaveRoom = () => {
      if (settled) return;
      settled = true;
      resolveRoom();
    };

    socket.on("message:new", (message: ChannelSocketMessage) => {
      if (settled || ownMessageIds.has(message.id)) return;

      const command = extractCommand(message.body, triggerPhrase);
      if (!command) return;

      core.info(`[room] "${triggerPhrase}" triggered by message ${message.id} in channel:${channel.id}`);
      const task = runTriggeredChannelReply({
        credentials,
        command,
        systemContext,
        mcpServer: server,
        extraMcpServers,
        allowedTools,
        maxTurns,
        socket,
        ownMessageIds,
      }).then((id) => {
        if (id) lastMessageId = id;
      });
      inFlight.add(task);
      task.finally(() => inFlight.delete(task));
    });

    // userIds is deduplicated by user, not by connection, and always
    // includes this action's own bot connection while it's joined -- so a
    // count of 1 always means "just me left", regardless of who that one
    // id actually is.
    socket.on("presence:update", ({ userIds }: { userIds: string[] }) => {
      core.info(`[room] presence update for channel:${channel.id}: ${userIds.length} online`);
      if (userIds.length <= 1) {
        core.info(`[room] only self left in channel:${channel.id}; leaving`);
        leaveRoom();
      }
    });

    socket.on("disconnect", (reason: string) => {
      core.info(`[room] disconnected from channel:${channel.id}: ${reason}`);
      leaveRoom();
    });

    socket.io.on("reconnect_failed", () => {
      core.error(`[room] gave up reconnecting to channel:${channel.id}`);
      leaveRoom();
    });
  });

  // Let any agent runs that were still going when the room emptied finish
  // and post their reply before the action exits.
  await Promise.allSettled([...inFlight]);
  socket.disconnect();

  core.setOutput("conclusion", "success");
  if (lastMessageId) {
    core.setOutput("message-id", lastMessageId);
  }
}

async function run(): Promise<void> {
  const anthropicApiKey = getInput("anthropic-api-key") || undefined;
  const claudeCodeOAuthToken = getInput("claude-code-oauth-token") || undefined;
  const notomateBaseUrl = getInput("notomate-base-url", { required: true });
  const notomateApiKey = getInput("notomate-api-key", { required: true });
  const triggerPhrase = getInput("trigger-phrase") || "@claude";
  const allowedToolsOverride = getInput("allowed-tools");
  const directPrompt = getInput("direct-prompt");
  const maxTurns = Number.parseInt(getInput("max-turns") || "30", 10);

  if (!anthropicApiKey && !claudeCodeOAuthToken) {
    core.setFailed(
      "Either anthropic-api-key or claude-code-oauth-token must be provided.",
    );
    return;
  }

  let extraMcpServers: Record<string, ExternalMcpServerConfig>;
  try {
    extraMcpServers = parseExternalMcpConfig(getInput("mcp-config"));
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
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
      await handleComment(
        payload,
        client,
        collab,
        credentials,
        triggerPhrase,
        allowedToolsOverride,
        extraMcpServers,
        maxTurns,
      );
      return;
    case "channel.room_created":
      await handleRoomCreated(
        payload,
        client,
        collab,
        credentials,
        triggerPhrase,
        allowedToolsOverride,
        extraMcpServers,
        maxTurns,
        notomateBaseUrl,
        notomateApiKey,
      );
      return;
    default:
      if (directPrompt) {
        await handleDirectPrompt(
          payload,
          client,
          collab,
          credentials,
          directPrompt,
          allowedToolsOverride,
          extraMcpServers,
          maxTurns,
        );
        return;
      }
      core.info(
        `Ignoring event of type "${payload.event}" (only comment.created and channel.room_created are handled, ` +
          `unless direct-prompt is set).`,
      );
      core.setOutput("conclusion", "skipped");
  }
}

run();
