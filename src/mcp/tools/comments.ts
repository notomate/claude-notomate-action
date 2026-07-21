import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { NotomateClient } from "../../notomate-client.js";
import { type DefaultContext, resolveNoteId, resolveWorkspaceId, textResult } from "../context.js";

/**
 * NOTE: create_comment is intentionally NOT exposed here. The action's own
 * reply-posting logic (src/index.ts) always calls client.createComment
 * directly with the triggering comment's thread_id, so the LLM cannot be
 * talked into posting extra top-level comments or replies outside the
 * current thread. Read/update/delete on existing comments are still useful
 * and safe to expose.
 */
export function createCommentTools(client: NotomateClient, ctx: DefaultContext) {
  return [
    tool(
      "list_comments",
      "List all comments on a note, including thread structure.",
      {
        workspaceId: z.string().optional(),
        noteId: z.string().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const noteId = resolveNoteId(args.noteId, ctx);
        return textResult(await client.listComments(workspaceId, noteId));
      },
    ),

    tool(
      "update_comment",
      "Edit an existing comment's body. Only the comment's author can do this.",
      {
        workspaceId: z.string().optional(),
        noteId: z.string().optional(),
        commentId: z.string(),
        body: z.string(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const noteId = resolveNoteId(args.noteId, ctx);
        const result = await client.updateComment(workspaceId, noteId, args.commentId, {
          body: args.body,
        });
        return textResult(result);
      },
    ),

    tool(
      "delete_comment",
      "Delete a comment. Only the comment's author can do this.",
      {
        workspaceId: z.string().optional(),
        noteId: z.string().optional(),
        commentId: z.string(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const noteId = resolveNoteId(args.noteId, ctx);
        await client.deleteComment(workspaceId, noteId, args.commentId);
        return textResult(`Deleted comment ${args.commentId}`);
      },
    ),
  ];
}
