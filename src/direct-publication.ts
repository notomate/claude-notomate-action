import type { NotomateClient } from "./notomate-client.js";

export interface PublicationOptions {
  publish: boolean;
  visibility: "private" | "public" | "workspace";
}

export function parsePublicationOptions(publish = "", visibility = ""): PublicationOptions {
  if (publish !== "" && publish !== "true" && publish !== "false") {
    throw new Error("publish-note must be true or false.");
  }
  if (visibility !== "" && !["private", "public", "workspace"].includes(visibility)) {
    throw new Error("note-visibility must be private, public, or workspace.");
  }
  return {
    publish: publish !== "false",
    visibility: (visibility || "private") as PublicationOptions["visibility"],
  };
}

// Remove these tools from the server, not just allowedTools: the agent runs
// with bypassPermissions, so an allow-list alone cannot enforce this policy.
export const DIRECT_EXCLUDED_TOOLS = ["create_note", "set_note_visibility"];

export function publicationContext(options: PublicationOptions): string {
  return options.publish
    ? `The action will publish your final response as one ${options.visibility} note. ` +
      "Do not create or publish notes yourself, even if the task asks you to call create_note. " +
      "Return the complete Markdown note, starting with a single # title line. " +
      "If information cannot be retrieved, return a truthful failure explanation as the note content. " +
      "Do not claim the note has already been published."
    : "Note publication is disabled by publish-note=false. Do not create or publish notes, " +
      "even if the task requests it. Return your result in the final response for the run log.";
}

export async function publishDirectResult(
  client: Pick<NotomateClient, "createNote">,
  workspaceId: string,
  replyText: string,
  options: PublicationOptions,
): Promise<string | undefined> {
  if (!options.publish) return undefined;
  const text = replyText.trim();
  if (!text) throw new Error("Agent returned no content to publish.");
  const heading = /^#\s+([^\r\n]+)(?:\r?\n|$)/.exec(text);
  const title = heading?.[1].trim() || "Workflow result";
  const content = heading ? text.slice(heading[0].length).trim() || title : text;
  const result = await client.createNote(workspaceId, { title, content, visibility: options.visibility });
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id) {
    throw new Error("Note creation returned no note id; publication could not be confirmed.");
  }
  return result.id;
}
