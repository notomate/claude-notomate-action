import * as core from "@actions/core";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import jwt from "jsonwebtoken";
import { WebSocket as NodeWebSocket } from "ws";
import { z } from "zod";
import * as Y from "yjs";

/**
 * notomate's editor stores content as a TipTap/ProseMirror JSON document tree
 * (see notomate's web/src/components/editor/Editor.tsx). Node shapes vary
 * widely (headings, tables, custom nodes, ...) so this only pins down the
 * envelope and leaves node internals open.
 */
export const tiptapDocSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export type TiptapDoc = z.infer<typeof tiptapDocSchema>;

export interface CollabConfig {
  /**
   * Origin (protocol://host[:port]) notomate is reachable at — the same
   * origin its own editor opens a collab connection against (see
   * deriveCollabWsOrigin). Not a standalone input: derived from
   * notomate-base-url.
   */
  url: string;
  /** Same secret notomate's API signs user session JWTs with (APP_SECRET). */
  appSecret: string;
  /** Id of the notomate user this automation acts as when editing notes. */
  botUserId: string;
}

/** As configured on the action: only required once update_note is actually called. */
export type PartialCollabConfig = Partial<CollabConfig>;

const COLLAB_INPUT_NAMES: Record<keyof CollabConfig, string> = {
  url: "notomate-base-url",
  appSecret: "notomate-app-secret",
  botUserId: "notomate-bot-user-id",
};

/**
 * notomate's own editor connects to its collab room at
 * `${protocol}//${window.location.host}/ws/notes/${noteId}` — the same
 * origin nginx serves the app from (see notomate's
 * web/src/hooks/use-note-collab.ts and nginx/nginx.conf.template's /ws/
 * location). Deriving from notomate-base-url instead of a separate input
 * keeps this action pointed at whatever single origin notomate is actually
 * reachable through, same as the browser.
 */
export function deriveCollabWsOrigin(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${parsed.host}`;
}

/** Validates a PartialCollabConfig is complete enough to open a collab connection. */
export function resolveCollabConfig(config: PartialCollabConfig): CollabConfig {
  const missing = (Object.keys(COLLAB_INPUT_NAMES) as (keyof CollabConfig)[]).filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `update_note requires the following action input(s) to be set: ${missing
        .map((key) => COLLAB_INPUT_NAMES[key])
        .join(", ")}`,
    );
  }
  return config as CollabConfig;
}

export interface NoteCollabUpdate {
  title?: string;
  content?: TiptapDoc;
}

const CONNECT_TIMEOUT_MS = 15_000;
const FLUSH_TIMEOUT_MS = 10_000;
const DEFAULT_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function signServiceToken(config: CollabConfig): string {
  return jwt.sign({ id: config.botUserId }, config.appSecret, {
    algorithm: "HS256",
    expiresIn: "10m",
  });
}

// Mirrors the sanitation notomate's own editor applies before rendering
// (Editor.tsx's sanitizeContent): ProseMirror rejects empty text nodes, and a
// bad node here would corrupt the doc for every collaborator who loads it.
function sanitizeContent(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  const n = node as Record<string, unknown>;
  if (n.type === "text") {
    return n.text ? n : null;
  }
  if (Array.isArray(n.content)) {
    return { ...n, content: n.content.map(sanitizeContent).filter(Boolean) };
  }
  return n;
}

/**
 * notomate's collab server authenticates connections by reading a `token`
 * cookie off the WebSocket upgrade request (notomate/collab's
 * auth-extension.js), not via the Hocuspocus auth-protocol handshake, so the
 * token has to be injected as a real HTTP header on the upgrade request.
 */
function authenticatedWebSocketPolyfill(token: string) {
  return class extends NodeWebSocket {
    constructor(address: string) {
      super(address, [], { headers: { Cookie: `token=${token}` } });
    }
  };
}

/**
 * Updates a note by editing it live in its Hocuspocus room, the same way
 * notomate's editor does, instead of going through the REST API. Content and
 * title live in the room's Y.Doc as `content.data` (a JSON-stringified TipTap
 * document) and `meta.title` respectively; notomate's collab server persists
 * them back to the notes table on its own debounce.
 */
export async function updateNoteViaCollab(
  config: CollabConfig,
  noteId: string,
  update: NoteCollabUpdate,
): Promise<void> {
  const wsUrl = `${config.url}/ws/notes/${noteId}`;
  core.info(
    `[update_note] connecting to ${wsUrl} as bot user ${config.botUserId} ` +
      `(title=${update.title !== undefined ? "set" : "unset"}, content=${update.content !== undefined ? "set" : "unset"})`,
  );

  const token = signServiceToken(config);
  const yDoc = new Y.Doc();

  // Constructed explicitly (rather than via HocuspocusProvider's `url` shorthand)
  // because WebSocketPolyfill can only be set through HocuspocusProviderWebsocket's
  // own config; HocuspocusProvider's `url` shorthand doesn't accept it. The path
  // matches notomate's own editor (use-note-collab.ts) so it lands on nginx's
  // /ws/ location the same way a browser connection would.
  let connectionAttempts = 0;
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: wsUrl,
    WebSocketPolyfill: authenticatedWebSocketPolyfill(token),
    onStatus: ({ status }) => {
      if (status === "connecting") connectionAttempts += 1;
      core.info(`[update_note] websocket status for note:${noteId}: ${status} (attempt ${connectionAttempts})`);
    },
    onClose: ({ event }) => {
      core.info(
        `[update_note] websocket closed for note:${noteId}: code=${event?.code ?? "?"} reason=${event?.reason || "<none>"}`,
      );
    },
  });

  const provider = new HocuspocusProvider({
    name: `note:${noteId}`,
    document: yDoc,
    awareness: null,
    websocketProvider,
  });
  // HocuspocusProvider only self-attaches when it creates its own websocketProvider
  // (manageSocket); since we supply one to get WebSocketPolyfill, we must attach it
  // ourselves, or this document's Auth/Sync messages are never sent and the
  // connection sits open forever without synced/authenticationFailed/close ever firing.
  provider.attach();

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out connecting to collab room note:${noteId}`)),
        CONNECT_TIMEOUT_MS,
      );
      provider.on("synced", () => {
        core.info(`[update_note] synced with collab room note:${noteId}`);
        clearTimeout(timer);
        resolve();
      });
      provider.on("authenticationFailed", ({ reason }: { reason: string }) => {
        core.info(`[update_note] authenticationFailed for note:${noteId}: ${reason}`);
        clearTimeout(timer);
        reject(new Error(`Collab authentication failed for note:${noteId}: ${reason}`));
      });
      provider.on("close", ({ event }: { event: { reason?: string } }) => {
        core.info(`[update_note] connection closed for note:${noteId} before syncing: ${event?.reason ?? "unknown reason"}`);
        clearTimeout(timer);
        reject(
          new Error(
            `Collab connection to note:${noteId} closed before syncing: ${event?.reason ?? "unknown reason"}`,
          ),
        );
      });
    });

    core.debug(`[update_note] pre-update content.data: ${yDoc.getMap("content").get("data")}`);
    core.debug(`[update_note] pre-update meta.title: ${yDoc.getMap("meta").get("title")}`);

    yDoc.transact(() => {
      if (update.content !== undefined) {
        const sanitized = sanitizeContent(update.content) ?? DEFAULT_DOC;
        const serialized = JSON.stringify(sanitized);
        core.info(`[update_note] setting content.data (${serialized.length} chars)`);
        core.debug(`[update_note] content.data: ${serialized}`);
        yDoc.getMap("content").set("data", serialized);
      }
      if (update.title !== undefined) {
        core.info(`[update_note] setting meta.title to "${update.title}"`);
        yDoc.getMap("meta").set("title", update.title);
      }
    }, "local");

    core.info(`[update_note] unsyncedChanges after transact: ${provider.unsyncedChanges}`);

    await new Promise<void>((resolve, reject) => {
      if (provider.unsyncedChanges === 0) {
        core.info(`[update_note] no unsynced changes to flush; treating as already acked`);
        resolve();
        return;
      }
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for collab server to ack the update to note ${noteId}`)),
        FLUSH_TIMEOUT_MS,
      );
      provider.on("unsyncedChanges", (count: number) => {
        core.debug(`[update_note] unsyncedChanges event: ${count}`);
        if (provider.unsyncedChanges === 0) {
          core.info(`[update_note] collab server acked update for note:${noteId}`);
          clearTimeout(timer);
          resolve();
        }
      });
    });
  } finally {
    // The collab server flushes any pending debounced save immediately once
    // the last connection to a room disconnects (unloadImmediately, on by
    // default), so persistence is guaranteed by the time this returns.
    core.info(`[update_note] disconnecting from note:${noteId}`);
    // provider.disconnect() is a deprecated no-op in v4 (see HocuspocusProvider's
    // manageSocket split) -- the real connection lives on websocketProvider now.
    websocketProvider.disconnect();
    provider.destroy();
    websocketProvider.destroy();
    yDoc.destroy();
  }
}
