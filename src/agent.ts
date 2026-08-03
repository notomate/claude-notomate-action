import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { NOTOMATE_SERVER_NAME } from "./mcp/server.js";
import type { ExternalMcpServerConfig } from "./mcp/external-config.js";

export interface AgentCredentials {
  anthropicApiKey?: string;
  claudeCodeOAuthToken?: string;
}

export interface RunAgentOptions {
  credentials: AgentCredentials;
  prompt: string;
  systemContext: string;
  mcpServer: McpSdkServerConfigWithInstance;
  /** Additional MCP servers from the mcp-config input, keyed by server name. */
  extraMcpServers?: Record<string, ExternalMcpServerConfig>;
  allowedTools: string[];
  maxTurns: number;
  /** Called with a short human-readable status line as the agent uses tools,
   * so callers can surface progress (e.g. editing it into a chat message)
   * before the final result is ready. Awaited before the run continues, so
   * status updates land in the order the agent produced them. */
  onStatus?: (status: string) => void | Promise<void>;
}

export interface RunAgentResult {
  replyText: string;
  isError: boolean;
}

const SYSTEM_PROMPT = `You are an automation bot embedded in notomate, a self-hosted note-taking app.
You were triggered either because someone tagged you in a note comment or a channel message, or by
a direct/scheduled trigger with a fixed task and no comment or message to reply to (check your
context for which). Use the notomate tools available to you to satisfy the request
(reading/writing notes, comments, channel messages, views, workflows, etc as needed).
When note content is included in your context, it is notomate's raw stored format (TipTap
editor JSON, a ProseMirror-style document tree) — not markdown or plain text. Read it as
structured content, not literal prose. create_note takes plain markdown and notomate converts
it to TipTap JSON server-side, but update_note edits the note live in its collaborative room
and requires content as a TipTap JSON document ({ type: "doc", content: [...] }) matching that
same format, not markdown.
If you were tagged in a comment or channel message, reply with a concise, plain-text/markdown
answer suitable for posting as a single reply there. If you were triggered directly with a fixed
task instead (no comment or message to reply to), just carry out the task with your tools --
nothing you say is posted anywhere, so a short summary of what you did is enough.
Do not include the words "@claude" anywhere in note/comment/message content you write, to avoid re-triggering this same automation.`;

/**
 * Pulls tool names out of an assistant message's content blocks. Checked
 * structurally rather than typed against the SDK's re-exported Anthropic
 * content-block types, since those come from @anthropic-ai/sdk without that
 * package being a direct dependency here.
 */
function extractToolUseNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (block): block is { type: "tool_use"; name: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "tool_use" &&
        typeof (block as { name?: unknown }).name === "string",
    )
    .map((block) => block.name);
}

/**
 * Runs a single non-interactive agent turn and returns the final synthesized
 * answer text (SDKResultMessage.result on the "success" subtype), which is
 * what gets posted back as the reply comment.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const fullPrompt = options.systemContext
    ? `${options.systemContext}\n\n${options.prompt}`
    : options.prompt;

  // The bundled Claude Code CLI checks ANTHROPIC_API_KEY first, then falls
  // back to CLAUDE_CODE_OAUTH_TOKEN (the token from `claude setup-token`,
  // used when running under a Claude subscription instead of a metered API
  // key). Only set the vars that were actually supplied so an unset one
  // doesn't shadow an ambient credential with an empty string.
  const authEnv: Record<string, string> = {
    // notomate runners execute jobs as root inside a throwaway container, and
    // the bundled Claude Code CLI refuses --dangerously-skip-permissions
    // under root/sudo unless this is set, exiting 1 before doing anything.
    IS_SANDBOX: "1",
  };
  if (options.credentials.anthropicApiKey) {
    authEnv.ANTHROPIC_API_KEY = options.credentials.anthropicApiKey;
  }
  if (options.credentials.claudeCodeOAuthToken) {
    authEnv.CLAUDE_CODE_OAUTH_TOKEN = options.credentials.claudeCodeOAuthToken;
  }

  const stream = query({
    prompt: fullPrompt,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      mcpServers: { [NOTOMATE_SERVER_NAME]: options.mcpServer, ...options.extraMcpServers },
      allowedTools: options.allowedTools,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: options.maxTurns,
      env: { ...process.env, ...authEnv },
    },
  });

  for await (const message of stream) {
    if (message.type === "assistant" && options.onStatus) {
      const toolNames = extractToolUseNames(message.message?.content);
      if (toolNames.length > 0) {
        await options.onStatus(`⏳ Working… (using \`${toolNames.join("`, `")}\`)`);
      }
    }

    if (message.type === "result") {
      if (message.subtype === "success") {
        return { replyText: message.result, isError: message.is_error };
      }
      return {
        replyText: `Agent run did not complete successfully (${message.subtype}).`,
        isError: true,
      };
    }
  }

  return { replyText: "Agent run produced no result.", isError: true };
}
