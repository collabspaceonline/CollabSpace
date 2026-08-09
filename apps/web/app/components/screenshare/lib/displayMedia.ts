import {
  CAPTURE_ERRORS,
  DISPLAY_CAPTURE_OPTIONS,
  SCREEN_CONTENT_HINT,
} from "../constants";
import type { ShareSurface } from "../types";

/**
 * The browser side of screen capture. Everything that touches
 * `getDisplayMedia` lives here — the hook above it only sees a MediaStream.
 */

/** getDisplayMedia needs a secure context, so this is false on plain http. */
export function isDisplayCaptureSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

/**
 * Opens the browser's own picker, positioned on the pane matching `surface`.
 *
 * We cannot draw the list of tabs and windows ourselves — the browser owns that
 * list for good security reasons. What our picker does is choose *which* pane
 * opens, which is exactly what Meet does too.
 */
export async function captureDisplaySurface(surface: ShareSurface): Promise<MediaStream> {
  const options = DISPLAY_CAPTURE_OPTIONS[surface];
  // Cast at the boundary: the Chromium-only hints are typed in `types.ts` but
  // absent from some lib.dom versions. Unknown members are ignored by browsers.
  const stream = await navigator.mediaDevices.getDisplayMedia(
    options as unknown as DisplayMediaStreamOptions,
  );

  const [video] = stream.getVideoTracks();
  if (video) video.contentHint = SCREEN_CONTENT_HINT;

  return stream;
}

/**
 * The user pressing Cancel in the picker — expected, not an error to report.
 *
 * Browsers reuse `NotAllowedError` for "you cancelled" *and* "the OS refused"
 * (macOS screen-recording permission). Only the message separates them, so a
 * system refusal falls through to `describeCaptureError` and is shown.
 */
export function isCaptureCancelled(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  if (error.name !== "NotAllowedError") return false;
  return !/permission denied by system/i.test(error.message);
}

export function describeCaptureError(error: unknown): string {
  if (error instanceof Error && CAPTURE_ERRORS[error.name]) {
    return CAPTURE_ERRORS[error.name]!;
  }
  return "Could not start screen sharing. Please try again.";
}

/** Stops every track, which is what makes Chrome's sharing bar disappear. */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Fires when the share ends outside our UI — the "Stop sharing" button in
 * Chrome's floating bar, closing the shared window, unplugging the monitor.
 * Returns an unsubscribe function.
 */
export function onCaptureEnded(stream: MediaStream, handler: () => void): () => void {
  const tracks = stream.getVideoTracks();
  tracks.forEach((track) => track.addEventListener("ended", handler));
  return () => tracks.forEach((track) => track.removeEventListener("ended", handler));
}
