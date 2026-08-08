import { VIRTUAL_H, VIRTUAL_W } from "../../constants";
import type { FabricObj } from "../../types";
import type { CanvasContext } from "../context";

/**
 * Bottom-right minimap. Redraws on every after:render so it can never drift
 * out of sync with the main canvas.
 */
export function registerMinimap(ctx: CanvasContext): void {
  const { canvas, elements } = ctx;

  canvas.on("after:render", () => {
    const mc = elements.minimap.current;
    if (!mc) return;
    const mctx = mc.getContext("2d");
    if (!mctx) return;

    const mw = mc.width; // physical canvas pixels (set via width/height attrs)
    const mh = mc.height;
    const sx = mw / VIRTUAL_W; // world → minimap scale
    const sy = mh / VIRTUAL_H;

    mctx.clearRect(0, 0, mw, mh);

    const vt = canvas.viewportTransform!;
    const zoom = canvas.getZoom();

    // Draw each shape as a filled rectangle at its bounding box.
    // getBoundingRect() returns screen-space coords — convert to world first.
    (canvas.getObjects() as FabricObj[]).forEach((obj: FabricObj) => {
      const b = obj.getBoundingRect();
      mctx.fillStyle = "rgba(255,255,255,0.4)";
      mctx.fillRect(
        ((b.left - vt[4]) / zoom) * sx,
        ((b.top - vt[5]) / zoom) * sy,
        Math.max((b.width / zoom) * sx, 2),
        Math.max((b.height / zoom) * sy, 2),
      );
    });

    // Draw the current viewport as a blue stroke rectangle.
    mctx.strokeStyle = "#4f8ef7";
    mctx.lineWidth = 2;
    mctx.strokeRect(
      (-vt[4] / zoom) * sx,
      (-vt[5] / zoom) * sy,
      (canvas.width! / zoom) * sx,
      (canvas.height! / zoom) * sy,
    );
  });
}
