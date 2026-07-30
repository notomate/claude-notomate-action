import * as core from "@actions/core";
import { io, type Socket } from "socket.io-client";

export interface MessagingClientConfig {
  /** Same origin notomate is reachable at (nginx-fronted), matching notomate-base-url;
   * nginx proxies /socket.io/ to the messaging service (see nginx/nginx.conf.template). */
  url: string;
  /** Notomate personal API key (Authorization: Bearer), same one used for the REST API. */
  apiKey: string;
  channelId: string;
}

/**
 * Message shape as broadcast over a channel:<id> room's `message:new` /
 * `message:updated` events (see notomate's messaging/src/index.js and
 * api/internal/grpc/messaging_service.go's CreateMessageResponse) -- a
 * subset of NotomateMessage from event.ts: no workspace_id or updated_by.
 */
export interface ChannelSocketMessage {
  id: string;
  channel_id: string;
  body: string;
  edited: boolean;
  created_at: string;
  created_by: string;
  updated_at: string;
}

const CONNECT_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 15_000;
// Bounds how long this action keeps retrying against a messaging service
// that's down/unreachable, so a dead server can't strand the action running
// (and burning runner minutes) forever instead of ending per the "only self
// left" rule.
const RECONNECTION_ATTEMPTS = 10;

/**
 * Connects to notomate's messaging service (Socket.IO) and joins the given
 * channel's room, the same way notomate's own ChannelView does (see
 * notomate's web/src/hooks/use-channel-socket.ts) -- except authenticated
 * with a Bearer API key header (there's no browser cookie here) instead of
 * withCredentials, matching messaging/src/auth.js's two accepted auth paths.
 * Resolves once the room join handshake completes (mirrors notomate's own
 * two-stage io.use() auth: API key, then channel membership).
 */
export function connectChannelSocket(config: MessagingClientConfig): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(config.url, {
      auth: { channelId: config.channelId },
      extraHeaders: { Authorization: `Bearer ${config.apiKey}` },
      reconnectionAttempts: RECONNECTION_ATTEMPTS,
    });

    const connectTimer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Timed out connecting to notomate messaging for channel:${config.channelId}`));
    }, CONNECT_TIMEOUT_MS);

    // .once, not .on: these two only govern the initial join. Once resolved,
    // the caller owns the socket and wires up its own long-lived listeners
    // (message:new, presence:update, disconnect, reconnect_failed).
    socket.once("connect", () => {
      core.info(`[room] connected to channel:${config.channelId} (socket ${socket.id})`);
      clearTimeout(connectTimer);
      resolve(socket);
    });
    socket.once("connect_error", (err: Error) => {
      core.info(`[room] connect_error joining channel:${config.channelId}: ${err.message}`);
      clearTimeout(connectTimer);
      reject(err);
    });
  });
}

/**
 * Posts a message into the room over the socket (message:send), the same
 * write path notomate's own ChannelView uses (see
 * web/src/hooks/use-channel-socket.ts's sendMessage) instead of the REST
 * API -- so it shows up for other room members exactly like a message from
 * a real connected client, not as a side effect of an unrelated HTTP call.
 *
 * The messaging service's ack only confirms receipt ({ok: true}); it
 * doesn't carry the created message (see notomate's messaging/src/index.js),
 * so the id has to be recovered from the room's message:new echo, which the
 * server sends back to the sender's own socket too. A random zero-width
 * marker prefixed onto the body (invisible wherever it's rendered) lets
 * that echo be matched back to this exact call even if another message:send
 * with the same visible text is in flight at the same time.
 */
export function sendChannelMessage(socket: Socket, body: string): Promise<ChannelSocketMessage> {
  const marker = `​${Math.random().toString(36).slice(2, 10)}​`;
  const wireBody = `${marker}${body}`;

  return new Promise((resolve, reject) => {
    let settled = false;

    const onMessageNew = (message: ChannelSocketMessage) => {
      if (message.body !== wireBody) return;
      settled = true;
      clearTimeout(timer);
      socket.off("message:new", onMessageNew);
      resolve(message);
    };
    socket.on("message:new", onMessageNew);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.off("message:new", onMessageNew);
      reject(new Error("Timed out waiting for message:new echo after message:send"));
    }, SEND_TIMEOUT_MS);

    socket.emit("message:send", { body: wireBody }, (ack?: { ok: boolean }) => {
      if (settled || ack?.ok) return;
      settled = true;
      clearTimeout(timer);
      socket.off("message:new", onMessageNew);
      reject(new Error("message:send was not acknowledged by the messaging service"));
    });
  });
}

/**
 * Edits an existing message over the socket (message:update), the
 * notomate-side counterpart to sendChannelMessage added alongside it --
 * notomate's own ChannelView still edits via REST (see
 * api/internal/api/handler/message.go's UpdateMessage), which the API
 * server then relays to the room over Socket.IO itself
 * (broadcastMessageChange -> messaging service's /internal/broadcast); this
 * lets an already-connected socket like this action's skip that REST+relay
 * round trip and edit directly. Unlike sendChannelMessage, no echo
 * correlation is needed: the caller already knows the message's id, so the
 * ack alone is enough to confirm the edit landed.
 */
export function updateChannelMessage(socket: Socket, messageId: string, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ack after message:update for message ${messageId}`));
    }, SEND_TIMEOUT_MS);

    socket.emit("message:update", { messageId, body }, (ack?: { ok: boolean }) => {
      clearTimeout(timer);
      if (!ack?.ok) {
        reject(new Error(`message:update was not acknowledged for message ${messageId}`));
        return;
      }
      resolve();
    });
  });
}
