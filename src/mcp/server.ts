import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { PartialCollabConfig } from "../collab-client.js";
import type { NotomateClient } from "../notomate-client.js";
import type { DefaultContext } from "./context.js";
import { createNoteTools } from "./tools/notes.js";
import { createCommentTools } from "./tools/comments.js";
import { createMessageTools } from "./tools/messages.js";
import { createViewTools } from "./tools/views.js";
import { createStatsTools } from "./tools/stats.js";
import { createWorkflowTools } from "./tools/workflows.js";

export const NOTOMATE_SERVER_NAME = "notomate";

export function buildNotomateMcpServer(client: NotomateClient, ctx: DefaultContext, collab: PartialCollabConfig, excludedTools: string[] = []) {
  const tools = [
    ...createNoteTools(client, ctx, collab),
    ...createCommentTools(client, ctx),
    ...createMessageTools(client, ctx),
    ...createViewTools(client, ctx),
    ...createStatsTools(client, ctx),
    ...createWorkflowTools(client, ctx),
  ].filter((tool) => !excludedTools.includes(tool.name));

  const server = createSdkMcpServer({
    name: NOTOMATE_SERVER_NAME,
    version: "0.1.0",
    tools,
  });

  return { server, tools };
}

/**
 * In-process MCP tools surface to the agent as mcp__<serverName>__<toolName>.
 * Build the allow-list from the registered tools so it can't drift from the
 * actual tool set. Names already qualified this way (e.g. tools from an
 * external server added via mcp-config, like mcp__yfmcp__yfinance_search)
 * are passed through unchanged rather than double-wrapped.
 */
export function buildAllowedToolNames(toolNames: string[]): string[] {
  return toolNames.map((name) => (name.includes("__") ? name : `mcp__${NOTOMATE_SERVER_NAME}__${name}`));
}
