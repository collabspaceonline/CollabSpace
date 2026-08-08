import type { RefObject } from "react";
import type { Socket } from "socket.io-client";

export type ToolType = "select" | "rect" | "circle" | "line" | "pen" | "eraser" | "text";

/**
 * Fabric objects carry two properties we add ourselves — `shapeId` (our stable
 * cross-client id) and `__version` (the last server version we saw) — which
 * Fabric's own types do not allow, so board code treats them as loose objects.
 */
export type FabricObj = any;
export type FabricCanvasLike = any;

/** The parts of Fabric's event payloads the board actually reads. */
export interface FabricPointerEvent {
  e: MouseEvent;
  target?: FabricObj;
}
export interface FabricWheelEvent {
  e: WheelEvent;
}
export interface FabricTargetEvent {
  target?: FabricObj;
}
export interface FabricPathEvent {
  path: FabricObj;
}

/** A shape as it travels over the wire: Fabric's serialised form plus our id. */
export interface Shape {
  id: string;
  type?: string;
  version?: number;
  [key: string]: any;
}

export interface WhiteboardProps {
  socket: Socket;
  theme?: "light" | "dark";
}

/** Tool + style values the canvas reads on every pointer event. */
export interface StyleRefs {
  tool: RefObject<ToolType>;
  fill: RefObject<string>;
  stroke: RefObject<string>;
  strokeWidth: RefObject<number>;
  opacity: RefObject<number>;
}

/** Scratch state for an in-progress drag (drawing or erasing). */
export interface DrawingRefs {
  isDrawingShape: RefObject<boolean>;
  isErasing: RefObject<boolean>;
  origin: RefObject<{ x: number; y: number } | null>;
  activeShape: RefObject<FabricObj | null>;
  line: RefObject<FabricObj | null>;
  liveThrottle: RefObject<number>;
  cursorThrottle: RefObject<number>;
}

/** DOM nodes the canvas features draw into, besides the Fabric canvas itself. */
export interface BoardElements {
  minimap: RefObject<HTMLCanvasElement | null>;
  cursorLayer: RefObject<HTMLDivElement | null>;
}

/** Canvas → React. Always call through `ctx.callbacks`, never capture directly. */
export interface BoardCallbacks {
  setShapeCount(count: number): void;
  setHasSelection(hasSelection: boolean): void;
  setTool(tool: ToolType): void;
  /** Pull fill/stroke/width/opacity from a newly selected object into the toolbar. */
  syncStyleFromObject(obj: FabricObj): void;
}
