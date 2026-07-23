import * as core from "@actions/core";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  type PartialCollabConfig,
  resolveCollabConfig,
  tiptapDocSchema,
  updateNoteViaCollab,
} from "../../collab-client.js";
import type { NotomateClient } from "../../notomate-client.js";
import { type DefaultContext, resolveNoteId, resolveWorkspaceId, textResult } from "../context.js";

export function createNoteTools(client: NotomateClient, ctx: DefaultContext, collab: PartialCollabConfig) {
  return [
    tool(
      "list_notes",
      "List notes in a workspace. Defaults to the current workspace if workspaceId is omitted.",
      {
        workspaceId: z.string().optional(),
        query: z.string().optional().describe("Free-text search"),
        parentId: z.string().optional(),
        pinnedOnly: z.boolean().optional(),
        page: z.number().int().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.listNotes(workspaceId, {
          query: args.query,
          parentId: args.parentId,
          pinnedOnly: args.pinnedOnly,
          page: args.page,
        });
        return textResult(result);
      },
    ),

    tool(
      "get_note",
      "Get a single note by id, including its full content. Defaults to the note the triggering comment belongs to.",
      {
        workspaceId: z.string().optional(),
        noteId: z.string().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const noteId = resolveNoteId(args.noteId, ctx);
        return textResult(await client.getNote(workspaceId, noteId));
      },
    ),

    tool(
      "create_note",
      "Create a new note. Content is written as plain markdown and converted server-side.",
      {
        workspaceId: z.string().optional(),
        title: z.string(),
        content: z.string().describe("Markdown content"),
        parentId: z.string().optional(),
        visibility: z.enum(["public", "workspace", "private"]).optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.createNote(workspaceId, {
          title: args.title,
          content: args.content,
          parentId: args.parentId,
          visibility: args.visibility,
        });
        return textResult(result);
      },
    ),

    tool(
      "update_note",
      "Update a note's title and/or content by editing it live in notomate's collaborative note room " +
        "(the same Hocuspocus/Y.js room notomate's editor connects to), so open editors see the change " +
        "immediately. content must be a TipTap/ProseMirror JSON document (e.g. { type: 'doc', content: [...] " +
        "}), notomate's raw stored format — not markdown.",
      {
        noteId: z.string().optional(),
        title: z.string().optional(),
        content: tiptapDocSchema.optional().describe("TipTap JSON document"),
      },
      async (args) => {
        const noteId = resolveNoteId(args.noteId, ctx);
        core.info(
          `[update_note tool] called with noteId=${noteId} (arg noteId=${args.noteId ?? "<default>"}, ` +
            `title=${args.title !== undefined ? JSON.stringify(args.title) : "<unset>"}, ` +
            `content=${args.content !== undefined ? "<provided>" : "<unset>"})`,
        );
        if (args.title === undefined && args.content === undefined) {
          core.info("[update_note tool] nothing to update; skipping collab connection");
          return textResult("Nothing to update: provide title and/or content.");
        }
        try {
          const resolvedConfig = resolveCollabConfig(collab);
          await updateNoteViaCollab(resolvedConfig, noteId, {
            title: args.title,
            content: args.content,
          });
          core.info(`[update_note tool] updateNoteViaCollab resolved for note ${noteId}`);
          return textResult(`Updated note ${noteId}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          core.error(`[update_note tool] failed for note ${noteId}: ${message}`);
          return { ...textResult(`Failed to update note ${noteId}: ${message}`), isError: true };
        }
      },
    ),

    tool(
      "delete_note",
      "Delete a note. This is irreversible.",
      {
        workspaceId: z.string().optional(),
        noteId: z.string().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const noteId = resolveNoteId(args.noteId, ctx);
        await client.deleteNote(workspaceId, noteId);
        return textResult(`Deleted note ${noteId}`);
      },
    ),

    tool(
      "set_note_visibility",
      "Change a note's visibility.",
      {
        workspaceId: z.string().optional(),
        noteId: z.string().optional(),
        visibility: z.enum(["public", "workspace", "private"]),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const noteId = resolveNoteId(args.noteId, ctx);
        await client.setNoteVisibility(workspaceId, noteId, args.visibility);
        return textResult(`Set visibility of note ${noteId} to ${args.visibility}`);
      },
    ),

    tool(
      "set_note_pin",
      "Pin or unpin a note.",
      {
        workspaceId: z.string().optional(),
        noteId: z.string().optional(),
        pinned: z.boolean(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const noteId = resolveNoteId(args.noteId, ctx);
        await client.setNotePin(workspaceId, noteId, args.pinned);
        return textResult(`Set pinned=${args.pinned} on note ${noteId}`);
      },
    ),
  ];
}
