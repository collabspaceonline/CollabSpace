import { Point as FabricPoint } from "fabric";
import { VIRTUAL_H, VIRTUAL_W, ZOOM_MAX, ZOOM_MIN } from "../constants";
import type { FabricCanvasLike, FabricWheelEvent } from "../types";

export interface ViewportController {
  isPanning(): boolean;
  startPan(e: MouseEvent): void;
  pan(e: MouseEvent): void;
  endPan(): void;
  /** Keep at least 1px of the virtual world on screen. */
  clamp(): void;
}

/**
 * Zoom + pan. Owns `mouse:wheel`; panning is driven from the pointer pipeline
 * because it has to win over the drawing tools.
 */
export function createViewport(canvas: FabricCanvasLike): ViewportController {
  let panning = false;
  let lastPan = { x: 0, y: 0 };

  const clamp = () => {
    const vt = canvas.viewportTransform!;
    const zoom = canvas.getZoom();
    // vt[4] is the X screen offset of world origin. Clamp so:
    //   right edge of virtual canvas ≥ left of screen  →  vt[4] ≥ -VIRTUAL_W*zoom
    //   left  edge of virtual canvas ≤ right of screen →  vt[4] ≤ canvas.width
    vt[4] = Math.min(Math.max(vt[4], -VIRTUAL_W * zoom), canvas.width!);
    vt[5] = Math.min(Math.max(vt[5], -VIRTUAL_H * zoom), canvas.height!);
  };

  canvas.on("mouse:wheel", (opt: FabricWheelEvent) => {
    const we = opt.e;
    let zoom = canvas.getZoom() * (0.999 ** we.deltaY);
    zoom = Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
    canvas.zoomToPoint(new FabricPoint(we.offsetX, we.offsetY), zoom);
    clamp();
    we.preventDefault();
    we.stopPropagation();
  });

  return {
    isPanning: () => panning,
    startPan(e) {
      panning = true;
      lastPan = { x: e.clientX, y: e.clientY };
      canvas.upperCanvasEl.style.cursor = "grabbing";
    },
    pan(e) {
      const vt = canvas.viewportTransform!;
      vt[4] += e.clientX - lastPan.x;
      vt[5] += e.clientY - lastPan.y;
      lastPan = { x: e.clientX, y: e.clientY };
      clamp();
      canvas.requestRenderAll();
    },
    endPan() {
      panning = false;
      canvas.upperCanvasEl.style.cursor = "";
    },
    clamp,
  };
}
