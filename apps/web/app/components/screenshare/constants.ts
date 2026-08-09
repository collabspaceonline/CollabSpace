import type { DisplayCaptureOptions, ShareSurface, ShareSurfaceOption } from "./types";

/** The picker's cards, in the order Google Meet lists them. */
export const SHARE_SURFACE_OPTIONS: ShareSurfaceOption[] = [
  {
    id: "browser",
    label: "A tab",
    description: "Best for video and animation — shares the tab's audio too",
    icon: "tab",
  },
  {
    id: "window",
    label: "A window",
    description: "Share a single app, and nothing else on your desktop",
    icon: "web_asset",
  },
  {
    id: "monitor",
    label: "Your entire screen",
    description: "Everything you see, including notifications",
    icon: "desktop_windows",
  },
];

export const DEFAULT_SHARE_SURFACE: ShareSurface = "monitor";

/** Short label for the badge on the presentation stage. */
export const SURFACE_LABELS: Record<ShareSurface, string> = {
  browser: "Tab",
  window: "Window",
  monitor: "Screen",
};

/**
 * Screen content is mostly static text, so the frame rate stays modest and the
 * resolution cap does the heavy lifting. Anything above 1080p costs bandwidth
 * that the receiver's tile cannot show anyway.
 */
const VIDEO_BASE: MediaTrackConstraints = {
  width: { max: 1920 },
  height: { max: 1080 },
  frameRate: { ideal: 15, max: 30 },
};

/**
 * Screen audio must skip the voice-call processing: echo cancellation and noise
 * suppression are tuned for a microphone and mangle music or video audio.
 */
const AUDIO_BASE: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * `displaySurface` is a hint, not a filter — Chrome still shows all three panes,
 * it just opens on the one asked for. Firefox and Safari ignore the extra hints
 * entirely and show their own picker, which is fine: the flow still works.
 */
export const DISPLAY_CAPTURE_OPTIONS: Record<ShareSurface, DisplayCaptureOptions> = {
  browser: {
    video: { ...VIDEO_BASE, displaySurface: "browser", frameRate: { ideal: 30, max: 30 } },
    audio: AUDIO_BASE,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: "exclude",
  },
  window: {
    video: { ...VIDEO_BASE, displaySurface: "window" },
    // Window capture carries no audio on any current browser; asking for it
    // only adds a checkbox that does nothing.
    audio: false,
    surfaceSwitching: "include",
    systemAudio: "exclude",
  },
  monitor: {
    video: { ...VIDEO_BASE, displaySurface: "monitor" },
    audio: AUDIO_BASE,
    monitorTypeSurfaces: "include",
    surfaceSwitching: "include",
    systemAudio: "include",
  },
};

/**
 * Tells the encoder to favour sharpness over smoothness — the difference
 * between readable code on a shared screen and a blur when the page scrolls.
 */
export const SCREEN_CONTENT_HINT = "detail";

/** Screen shares need far more bitrate than a talking head to stay legible. */
export const SCREEN_ENCODINGS = [{ maxBitrate: 3_000_000 }];

export const SCREEN_CODEC_OPTIONS = { videoGoogleStartBitrate: 1000 };

/** Picker errors we translate rather than surface raw. */
export const CAPTURE_ERRORS: Record<string, string> = {
  NotAllowedError: "Screen sharing was blocked. Allow it in your browser's site settings and try again.",
  NotFoundError: "No screen or window was available to share.",
  NotReadableError: "Your system would not hand over the screen. Close other recording apps and try again.",
  AbortError: "Screen sharing stopped before it started. Please try again.",
};

export const CAPTURE_UNSUPPORTED =
  "This browser cannot share a screen. Screen sharing needs a recent Chrome, Edge, Firefox or Safari over HTTPS.";

export const NO_TRANSPORT_ERROR = "Join the call before you present.";
