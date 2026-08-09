import type { FabricTargetEvent } from "../../types";
import type { CanvasContext } from "../context";

/**
 * Live text editing, outgoing half: every keystroke is broadcast, and the
 * shape is locked for other users while this client is typing in it.
 */
export function registerTextSync(ctx: CanvasContext): void {
  const { canvas, emit } = ctx;

  canvas.on("text:changed", (opt: FabricTargetEvent) => {
    const target = opt.target;
    if (!target?.shapeId) return;
    // Send the text and the width so word-wrapping matches on every client.
    emit.commitUpdate(target, { text: target.text, width: target.width });
  });

  canvas.on("text:editing:entered", (opt: FabricTargetEvent) => {
    const target = opt.target;
    if (!target?.shapeId) return;
    emit.lockShape(target.shapeId);
  });

  canvas.on("text:editing:exited", (opt: FabricTargetEvent) => {
    const target = opt.target;
    if (!target?.shapeId) return;
    emit.unlockShape(target.shapeId);
  });
}
