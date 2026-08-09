import type { Socket } from "socket.io-client";

/**
 * The three things you can present, named the way the W3C spec names them.
 * These strings are passed straight to `getDisplayMedia` as `displaySurface`,
 * which is what makes Chrome open its picker on the matching pane.
 *
 *   browser → a tab      window → an app window      monitor → the whole screen
 */
export type ShareSurface = "browser" | "window" | "monitor";

/**
 * What a producer's track *is*. Mirrors `MEDIA_SOURCES` in
 * `apps/sfu-server/src/config.js` — both halves must agree on these strings.
 */
export type MediaSource = "camera" | "mic" | "screen" | "screenAudio";

/** One live presentation, as announced by the server. */
export interface Presentation {
  socketId: string;
  surface: ShareSurface;
  startedAt: number;
}

/**
 * `getDisplayMedia` options including the Chromium-only hints that
 * `lib.dom`'s `DisplayMediaStreamOptions` does not always declare. Typing it
 * ourselves keeps the constraints readable instead of a wall of `as any`.
 */
export interface DisplayCaptureOptions {
  video: MediaTrackConstraints & { displaySurface?: ShareSurface };
  audio: boolean | MediaTrackConstraints;
  /** Whether the OS/tab audio is offered alongside the picture. */
  systemAudio?: "include" | "exclude";
  /** Hide the CollabSpace tab itself from the tab list — you never want it. */
  selfBrowserSurface?: "include" | "exclude";
  /** Show Chrome's "change source" button in the sharing bar. */
  surfaceSwitching?: "include" | "exclude";
  /** Whether whole monitors appear in the list. */
  monitorTypeSurfaces?: "include" | "exclude";
}

/** A card in the "Present now" picker. */
export interface ShareSurfaceOption {
  id: ShareSurface;
  label: string;
  /** One line under the label, same role as Meet's helper text. */
  description: string;
  /** Material Symbols icon name. */
  icon: string;
}

export interface UseScreenShareOptions {
  socket: Socket | null;
  /**
   * Read lazily: the mediasoup send transport is created long after this hook
   * mounts, so the hook must not capture it at render time.
   */
  getSendTransport: () => any;
}

/** What `useScreenShare` hands back to the UI. */
export interface ScreenShareController {
  /** True from the moment the tracks are produced until they are torn down. */
  isSharing: boolean;
  /** True while the browser picker is open / tracks are being produced. */
  isStarting: boolean;
  surface: ShareSurface | null;
  /** The local capture, for the presenter's own preview. */
  stream: MediaStream | null;
  /** Human-readable failure, or null. Cancelling the picker is not a failure. */
  error: string | null;
  start: (surface: ShareSurface) => Promise<void>;
  stop: () => Promise<void>;
  dismissError: () => void;
}
