import { readFileSync } from "node:fs";

export interface PayloadWorkspace {
  id: string;
  name: string;
}

export interface PayloadSender {
  id: string;
  name: string;
}

export interface NotomateNote {
  workspace_id: string;
  id: string;
  parent_id: string;
  title: string;
  content: string;
  visibility: string;
  pinned: boolean;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export interface NotomateComment {
  id: string;
  workspace_id: string;
  note_id: string;
  thread_id: string;
  quoted_text: string;
  body: string;
  edited: boolean;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export interface CommentEventPayload {
  event: string;
  workspace: PayloadWorkspace;
  sender?: PayloadSender;
  note?: NotomateNote;
  comment?: NotomateComment;
}

/**
 * Reads and parses the workflow event payload from $GITHUB_EVENT_PATH.
 * Notomate's runner (via act) writes the full event JSON there, mirroring
 * GitHub Actions' own convention — this is the only source with comment id /
 * thread id, since the NM_* env vars don't carry them.
 */
export function readEventPayload(): CommentEventPayload {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set");
  }
  const raw = readFileSync(eventPath, "utf-8");
  return JSON.parse(raw) as CommentEventPayload;
}

/**
 * Case-insensitively finds triggerPhrase in body and returns the trimmed
 * text after it, or null if the phrase isn't present or nothing follows it.
 */
export function extractCommand(
  body: string,
  triggerPhrase: string,
): string | null {
  const idx = body.toLowerCase().indexOf(triggerPhrase.toLowerCase());
  if (idx === -1) {
    return null;
  }
  const command = body.slice(idx + triggerPhrase.length).trim();
  return command.length > 0 ? command : null;
}
