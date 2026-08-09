import type { MediaSource } from "../types";

/**
 * Reading the `source` label the SFU puts on every producer.
 *
 * The room page consumes tracks for every producer in the room and has to send
 * them to the right place: a camera track joins the peer's participant tile, a
 * screen track becomes a presentation. These are the predicates it uses.
 */

/** Older producers arrive unlabelled; a video track is a camera unless told otherwise. */
export function normalizeSource(source: unknown, kind: "audio" | "video"): MediaSource {
  const known: MediaSource[] = ["camera", "mic", "screen", "screenAudio"];
  return known.includes(source as MediaSource)
    ? (source as MediaSource)
    : kind === "video"
      ? "camera"
      : "mic";
}

/** Both halves of a presentation — the picture and, for tabs, its audio. */
export function isScreenSource(source: MediaSource): boolean {
  return source === "screen" || source === "screenAudio";
}

/** The presentation's picture specifically; its end means the share is over. */
export function isScreenVideoSource(source: MediaSource): boolean {
  return source === "screen";
}
