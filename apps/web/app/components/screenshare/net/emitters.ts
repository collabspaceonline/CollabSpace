import { useMemo } from "react";
import type { Socket } from "socket.io-client";
import type { Presentation, ShareSurface } from "../types";

/**
 * Every outgoing screen-share message goes through here — one place to see the
 * client half of the wire protocol (the server half is in
 * `apps/sfu-server/src/socket/handlers/screenShare.js`, plus `closeProducer`
 * in `media.js`).
 */
export interface ScreenShareEmitters {
  /** Announce a presentation. The server echoes `screen:started` to everyone. */
  start(surface: ShareSurface): void;
  /** Announce the end. Safe to call when not presenting — the server ignores it. */
  stop(): void;
  /** Who is presenting right now; for joining a call mid-presentation. */
  getState(callback: (presentations: Presentation[]) => void): void;
  /**
   * Tear one producer down without leaving the call. mediasoup-client's
   * `producer.close()` is purely local, so the SFU has to be told separately or
   * it keeps forwarding a dead track.
   */
  closeProducer(producerId: string): void;
}

export function createScreenShareEmitters(socket: Socket | null): ScreenShareEmitters {
  return {
    start(surface) {
      socket?.emit("screen:start", { surface });
    },
    stop() {
      socket?.emit("screen:stop");
    },
    getState(callback) {
      if (!socket) return callback([]);
      socket.emit("screen:getState", callback);
    },
    closeProducer(producerId) {
      socket?.emit("closeProducer", { producerId });
    },
  };
}

export function useScreenShareEmitters(socket: Socket | null): ScreenShareEmitters {
  return useMemo(() => createScreenShareEmitters(socket), [socket]);
}
