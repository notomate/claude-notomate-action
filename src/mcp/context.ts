/** Default workspace/note the triggering comment belongs to, used to fill in
 * optional workspaceId/noteId tool params so the LLM doesn't have to guess
 * them for the common case, while still allowing override. */
export interface DefaultContext {
  workspaceId: string;
  noteId?: string;
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
