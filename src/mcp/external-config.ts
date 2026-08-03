import type {
  McpHttpServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from "@anthropic-ai/claude-agent-sdk";

export type ExternalMcpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig;

/**
 * Parses the `mcp-config` input: a JSON string shaped like Claude Code's own
 * mcpServers config (`{ "mcpServers": { "name": { "command": ..., ... } } }`).
 * Thrown errors are meant to fail the action outright rather than silently
 * run without the servers the workflow author asked for.
 */
export function parseExternalMcpConfig(raw: string): Record<string, ExternalMcpServerConfig> {
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `mcp-config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error('mcp-config must be a JSON object shaped like { "mcpServers": { ... } }');
  }

  const servers = (parsed as Record<string, unknown>).mcpServers;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
    throw new Error('mcp-config must have an "mcpServers" object property');
  }

  for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
      throw new Error(`mcp-config.mcpServers["${name}"] must be an object`);
    }
    const c = config as Record<string, unknown>;
    const hasCommand = typeof c.command === "string";
    const hasUrl = typeof c.url === "string";
    if (!hasCommand && !hasUrl) {
      throw new Error(`mcp-config.mcpServers["${name}"] must have a "command" (stdio) or "url" (sse/http)`);
    }
  }

  return servers as Record<string, ExternalMcpServerConfig>;
}
