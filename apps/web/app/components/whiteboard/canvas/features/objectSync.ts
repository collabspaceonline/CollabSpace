import { util as fabricUtil } from "fabric";
import { fabricObjToShape } from "../../lib/shape";
import type { FabricObj, FabricTargetEvent } from "../../types";
import type { CanvasContext } from "../context";

/**
 * Broadcast finished move / resize / rotate operations.
 *
 * Multi-select is the tricky case: objects inside an activeSelection report
 * coordinates relative to the group, so we decompose the transform matrix to
 * recover absolute world-space values before sending.
 */
export function registerObjectSync(ctx: CanvasContext): void {
  const { canvas, emit } = ctx;

  canvas.on("object:modified", (opt: FabricTargetEvent) => {
    const target = opt.target;
    if (!target) return;

    if (target.type === "activeSelection" || target.type === "group") {
      target.getObjects().forEach((obj: FabricObj) => {
        if (!obj.shapeId) return;

        const globalTransform = fabricUtil.qrDecompose(obj.calcTransformMatrix());
        const shape = fabricObjToShape(obj);

        // Overwrite the group-relative coordinates with absolute ones
        shape.left = globalTransform.translateX;
        shape.top = globalTransform.translateY;
        shape.scaleX = globalTransform.scaleX;
        shape.scaleY = globalTransform.scaleY;
        shape.angle = globalTransform.angle;

        emit.commitUpdate(obj, shape);
      });
      return;
    }

    if (target.shapeId) emit.commitUpdate(target);
  });
}
