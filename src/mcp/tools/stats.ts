import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { NotomateClient } from "../../notomate-client.js";
import { type DefaultContext, resolveWorkspaceId, textResult } from "../context.js";

export function createStatsTools(client: NotomateClient, ctx: DefaultContext) {
  return [
    tool(
      "get_note_counts_by_date",
      "Get a daily histogram of note creation counts for a workspace.",
      {
        workspaceId: z.string().optional(),
        days: z.number().int().min(1).max(730).default(30),
        timezoneOffset: z.number().int().default(0).describe("Minutes offset from UTC"),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(
          await client.getNoteCountsByDate(workspaceId, args.days, args.timezoneOffset),
        );
      },
    ),
  ];
}
