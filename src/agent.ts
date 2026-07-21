import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { NOTOMATE_SERVER_NAME } from "./mcp/server.js";

export interface AgentCredentials {
  anthropicApiKey?: string;
  claudeCodeOAuthToken?: string;
}

export interface RunAgentOptions {
  credentials: AgentCredentials;
  prompt: string;
  systemContext: string;
  mcpServer: McpSdkServerConfigWithInstance;
  allowedTools: string[];
  maxTurns: number;
}

export interface RunAgentResult {
  replyText: string;
  isError: boolean;
}

const SYSTEM_PROMPT = `You are an automation bot embedded in notomate, a self-hosted note-taking app.
You were triggered because someone tagged you in a comment. Use the notomate tools available to you
to satisfy the request (reading/writing notes, comments, views, workflows, etc as needed).
When note content is included in your context, it is notomate's raw stored format (TipTap
editor JSON, a ProseMirror-style document tree) — not markdown or plain text. Read it as
structured content, not literal prose. When you write or update a note yourself, write plain
markdown; notomate converts it to TipTap JSON server-side.
Reply with a concise, plain-text/markdown answer suitable for posting as a single comment reply.
Do not include the words "@claude" anywhere in your reply, to avoid re-triggering this same automation.`;

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
      mcpServers: { [NOTOMATE_SERVER_NAME]: options.mcpServer },
      allowedTools: options.allowedTools,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: options.maxTurns,
      env: { ...process.env, ...authEnv },
    },
  });

  for await (const message of stream) {
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
