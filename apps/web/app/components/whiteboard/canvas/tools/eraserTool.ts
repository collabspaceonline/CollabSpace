import type { FabricObj } from "../../types";
import type { CanvasContext } from "../context";

/** Remove whatever is under the cursor. Used for both click and swipe-erase. */
export function eraseTarget(ctx: CanvasContext, target: FabricObj | undefined): void {
  if (!target?.shapeId) return;
  const { canvas, emit, reportShapeCount } = ctx;
  const id = target.shapeId;
  canvas.remove(target);
  emit.deleteShape(id);
  canvas.requestRenderAll();
  reportShapeCount();
}
