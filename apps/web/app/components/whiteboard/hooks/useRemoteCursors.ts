import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

export type RemoteCursors = Record<string, { x: number; y: number }>;

/**
 * Live cursors, incoming half: other people's pointer positions in world
 * coordinates. The outgoing half is `canvas/features/cursorOverlay.ts`.
 */
export function useRemoteCursors(socket: Socket): RemoteCursors {
  const [cursors, setCursors] = useState<RemoteCursors>({});

  useEffect(() => {
    if (!socket) return;

    const drop = (socketId: string) =>
      setCursors((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });

    const onMove = ({ socketId, x, y }: { socketId: string; x: number; y: number }) =>
      setCursors((prev) => ({ ...prev, [socketId]: { x, y } }));
    const onLeave = ({ socketId }: { socketId: string }) => drop(socketId);
    const onPeerGone = ({ socketId }: { socketId: string }) => drop(socketId);

    socket.on("wb:cursorMove", onMove);
    socket.on("wb:cursorLeave", onLeave);
    socket.on("peer-disconnected", onPeerGone);

    // Detach by reference: the room page listens to `peer-disconnected` too,
    // and a bare socket.off(event) would tear its handler down as well.
    return () => {
      socket.off("wb:cursorMove", onMove);
      socket.off("wb:cursorLeave", onLeave);
      socket.off("peer-disconnected", onPeerGone);
    };
  }, [socket]);

  return cursors;
}
