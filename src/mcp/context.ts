/** Default workspace/note/channel the triggering comment or message belongs
 * to, used to fill in optional workspaceId/noteId/channelId tool params so
 * the LLM doesn't have to guess them for the common case, while still
 * allowing override. */
export interface DefaultContext {
  workspaceId: string;
  noteId?: string;
  channelId?: string;
}

export function resolveWorkspaceId(input: string | undefined, ctx: DefaultContext): string {
  const workspaceId = input ?? ctx.workspaceId;
  if (!workspaceId) {
    throw new Error("workspaceId is required and no default is available");
  }
  return workspaceId;
}

export function resolveNoteId(input: string | undefined, ctx: DefaultContext): string {
  const noteId = input ?? ctx.noteId;
  if (!noteId) {
    throw new Error("noteId is required and no default is available");
  }
  return noteId;
}

export function resolveChannelId(input: string | undefined, ctx: DefaultContext): string {
  const channelId = input ?? ctx.channelId;
  if (!channelId) {
    throw new Error("channelId is required and no default is available");
  }
  return channelId;
}

export function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}
