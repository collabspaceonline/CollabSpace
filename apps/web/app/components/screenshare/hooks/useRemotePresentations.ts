import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { useScreenShareEmitters } from "../net/emitters";
import type { Presentation } from "../types";

/** Newest presentation last, so the most recent one wins the stage. */
const byStartedAt = (a: Presentation, b: Presentation) => a.startedAt - b.startedAt;

/**
 * Everyone currently presenting, including us — the server echoes
 * `screen:started` back to the presenter so every client renders the same
 * banner from the same record.
 *
 * This is only the announcement; the pixels arrive separately as consumed
 * producers tagged `source: 'screen'`, which the room page routes.
 */
export function useRemotePresentations(socket: Socket | null): Presentation[] {
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const emitters = useScreenShareEmitters(socket);

  useEffect(() => {
    if (!socket) return;

    const onStarted = (presentation: Presentation) =>
      setPresentations((prev) =>
        [...prev.filter((p) => p.socketId !== presentation.socketId), presentation].sort(byStartedAt),
      );

    const onStopped = ({ socketId }: { socketId: string }) =>
      setPresentations((prev) => prev.filter((p) => p.socketId !== socketId));

    socket.on("screen:started", onStarted);
    socket.on("screen:stopped", onStopped);
    socket.on("peer-disconnected", onStopped);

    // Catch up: someone may already have been presenting when we joined.
    emitters.getState((current) => setPresentations([...current].sort(byStartedAt)));

    // Detach by reference — the room page listens to `peer-disconnected` too,
    // and a bare socket.off(event) would tear its handler down as well.
    return () => {
      socket.off("screen:started", onStarted);
      socket.off("screen:stopped", onStopped);
      socket.off("peer-disconnected", onStopped);
    };
  }, [socket, emitters]);

  return presentations;
}
