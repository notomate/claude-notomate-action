import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { NotomateClient } from "../../notomate-client.js";
import { type DefaultContext, resolveNoteId, resolveWorkspaceId, textResult } from "../context.js";

export function createNoteTools(client: NotomateClient, ctx: DefaultContext) {
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
      "Update a note's title and/or content (markdown).",
      {
        workspaceId: z.string().optional(),
        noteId: z.string().optional(),
        title: z.string().optional(),
        content: z.string().optional().describe("Markdown content"),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const noteId = resolveNoteId(args.noteId, ctx);
        const result = await client.updateNote(workspaceId, noteId, {
          title: args.title,
          content: args.content,
        });
        return textResult(result);
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
