import type { ToolType } from "./types";

/** Virtual canvas size — users cannot pan completely outside this boundary. */
export const VIRTUAL_W = 5000;
export const VIRTUAL_H = 5000;

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 20;

/** Gives a 15px radius cushion to clicking, making thin lines easy to erase. */
export const TARGET_FIND_TOLERANCE = 15;

/** Broadcast throttles, in ms. */
export const CURSOR_THROTTLE_MS = 33;    // ~30 fps
export const LIVE_SYNC_THROTTLE_MS = 50; // ~20 fps

/** Image import limits. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 1200;  // downscale before broadcasting
export const IMAGE_QUALITY = 0.85;
export const IMAGE_PLACE_MAX_SIDE = 400; // on-canvas size when dropped

export const MINIMAP_W = 192;
export const MINIMAP_H = 128;

/**
 * Per-tool default fill / stroke / stroke-width.
 * For line and pen, `fill` is what the canvas actually uses for the visible
 * stroke colour (see the line tool, and brush.color for pen).
 */
export const TOOL_DEFAULTS: Partial<
  Record<ToolType, { fill?: string; stroke?: string; strokeWidth?: number }>
> = {
  rect:   { fill: "transparent", stroke: "#818cf8", strokeWidth: 2 }, // indigo outline
  circle: { fill: "transparent", stroke: "#fb7185", strokeWidth: 2 }, // rose outline
  line:   { fill: "#22d3ee", strokeWidth: 3 },                    // cyan
  pen:    { fill: "#f59e0b", strokeWidth: 3 },                    // amber
  text:   { fill: "#9ca3af" },                                    // gray-400
};

/** Toolbar state at first mount — shared by the React state and the canvas refs. */
export const INITIAL_STYLE = {
  fill: "transparent",
  stroke: "#818cf8",
  strokeWidth: 2,
  opacity: 1,
};

export const TEXT_DEFAULT_FILL = "#9ca3af";
export const TEXT_DEFAULT_WIDTH = 200;
export const TEXT_DEFAULT_FONT_SIZE = 24;

/** Red glow shown on a text shape someone else is editing. */
export const LOCK_SHADOW = {
  color: "rgba(234, 67, 53, 0.6)",
  blur: 10,
  offsetX: 0,
  offsetY: 0,
};
