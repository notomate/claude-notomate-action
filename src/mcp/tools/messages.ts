import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { NotomateClient } from "../../notomate-client.js";
import { type DefaultContext, resolveChannelId, resolveWorkspaceId, textResult } from "../context.js";

/**
 * NOTE: create_message is intentionally NOT exposed here, mirroring
 * create_comment in comments.ts. The action's own reply-posting logic
 * (src/index.ts) always calls client.createChannelMessage directly in the
 * triggering message's channel, so the LLM cannot be talked into posting
 * extra messages into other channels. Read/update/delete on existing
 * messages, and listing channels, are still useful and safe to expose.
 */
export function createMessageTools(client: NotomateClient, ctx: DefaultContext) {
  return [
    tool(
      "list_channels",
      "List all channels in the workspace.",
      {
        workspaceId: z.string().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(await client.listChannels(workspaceId));
      },
    ),

    tool(
      "list_messages",
      "List all messages in a channel.",
      {
        workspaceId: z.string().optional(),
        channelId: z.string().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const channelId = resolveChannelId(args.channelId, ctx);
        return textResult(await client.listChannelMessages(workspaceId, channelId));
      },
    ),

    tool(
      "update_message",
      "Edit an existing channel message's body. Only the message's author can do this.",
      {
        workspaceId: z.string().optional(),
        channelId: z.string().optional(),
        messageId: z.string(),
        body: z.string(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const channelId = resolveChannelId(args.channelId, ctx);
        const result = await client.updateChannelMessage(workspaceId, channelId, args.messageId, {
          body: args.body,
        });
        return textResult(result);
      },
    ),

    tool(
      "delete_message",
      "Delete a channel message. Only the message's author can do this.",
      {
        workspaceId: z.string().optional(),
        channelId: z.string().optional(),
        messageId: z.string(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const channelId = resolveChannelId(args.channelId, ctx);
        await client.deleteChannelMessage(workspaceId, channelId, args.messageId);
        return textResult(`Deleted message ${args.messageId}`);
      },
    ),
  ];
}
