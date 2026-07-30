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
