import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { NotomateClient } from "../../notomate-client.js";
import { type DefaultContext, resolveWorkspaceId, textResult } from "../context.js";

const viewType = z.enum(["map", "calendar", "kanban", "whiteboard", "spreadsheet"]);

export function createViewTools(client: NotomateClient, ctx: DefaultContext) {
  return [
    tool(
      "list_views",
      "List views in a workspace, optionally filtered by type or the note they're attached to.",
      {
        workspaceId: z.string().optional(),
        type: viewType.optional(),
        noteId: z.string().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(
          await client.listViews(workspaceId, { type: args.type, noteId: args.noteId }),
        );
      },
    ),

    tool(
      "get_view",
      "Get a single view by id.",
      {
        workspaceId: z.string().optional(),
        viewId: z.string(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(await client.getView(workspaceId, args.viewId));
      },
    ),

    tool(
      "create_view",
      "Create a new view (calendar, map, kanban, whiteboard, or spreadsheet).",
      {
        workspaceId: z.string().optional(),
        name: z.string(),
        type: viewType,
        noteId: z.string().optional(),
        visibility: z.enum(["public", "workspace", "private"]).optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.createView(workspaceId, {
          name: args.name,
          type: args.type,
          noteId: args.noteId,
          visibility: args.visibility,
        });
        return textResult(result);
      },
    ),

    tool(
      "update_view",
      "Rename a view or replace its data payload.",
      {
        workspaceId: z.string().optional(),
        viewId: z.string(),
        name: z.string().optional(),
        data: z.unknown().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.updateView(workspaceId, args.viewId, {
          name: args.name,
          data: args.data,
        });
        return textResult(result);
      },
    ),

    tool(
      "delete_view",
      "Delete a view. This is irreversible.",
      {
        workspaceId: z.string().optional(),
        viewId: z.string(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        await client.deleteView(workspaceId, args.viewId);
        return textResult(`Deleted view ${args.viewId}`);
      },
    ),

    tool(
      "set_view_visibility",
      "Change a view's visibility.",
      {
        workspaceId: z.string().optional(),
        viewId: z.string(),
        visibility: z.enum(["public", "workspace", "private"]),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        await client.setViewVisibility(workspaceId, args.viewId, args.visibility);
        return textResult(`Set visibility of view ${args.viewId} to ${args.visibility}`);
      },
    ),

    tool(
      "list_view_objects",
      "List the objects (calendar slots, map markers, kanban columns, whiteboard elements, etc) inside a view.",
      {
        workspaceId: z.string().optional(),
        viewId: z.string(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        return textResult(await client.listViewObjects(workspaceId, args.viewId));
      },
    ),

    tool(
      "create_view_object",
      "Create an object inside a view. The object type must be compatible with the parent view's type (e.g. calendar_slot only for calendar views).",
      {
        workspaceId: z.string().optional(),
        viewId: z.string(),
        name: z.string(),
        type: z.string(),
        data: z.unknown(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.createViewObject(workspaceId, args.viewId, {
          name: args.name,
          type: args.type,
          data: args.data,
        });
        return textResult(result);
      },
    ),

    tool(
      "update_view_object",
      "Update an object inside a view.",
      {
        workspaceId: z.string().optional(),
        viewId: z.string(),
        objectId: z.string(),
        name: z.string().optional(),
        data: z.unknown().optional(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        const result = await client.updateViewObject(workspaceId, args.viewId, args.objectId, {
          name: args.name,
          data: args.data,
        });
        return textResult(result);
      },
    ),

    tool(
      "delete_view_object",
      "Delete an object inside a view.",
      {
        workspaceId: z.string().optional(),
        viewId: z.string(),
        objectId: z.string(),
      },
      async (args) => {
        const workspaceId = resolveWorkspaceId(args.workspaceId, ctx);
        await client.deleteViewObject(workspaceId, args.viewId, args.objectId);
        return textResult(`Deleted view object ${args.objectId}`);
      },
    ),
  ];
}
