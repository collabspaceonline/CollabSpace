import { Textbox } from "fabric";
import {
  TEXT_DEFAULT_FILL,
  TEXT_DEFAULT_FONT_SIZE,
  TEXT_DEFAULT_WIDTH,
  TOOL_DEFAULTS,
} from "../../constants";
import { isTextObject, newShapeId } from "../../lib/shape";
import type { FabricObj } from "../../types";
import type { CanvasContext } from "../context";

/**
 * The text tool. A click either resumes editing the text box under the cursor
 * or spawns a new one, then hands control back to the select tool.
 */
export function handleTextClick(ctx: CanvasContext, pointer: { x: number; y: number }): void {
  const { canvas, style, emit, callbacks } = ctx;

  // Clicking an existing text box edits it instead of stacking a new one on top.
  // Walk backwards so the top-most object wins.
  const objects = canvas.getObjects() as FabricObj[];
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || !isTextObject(obj) || !obj.containsPoint(pointer)) continue;

    // Locked by someone else — refuse rather than allow dual editing.
    if (obj.selectable === false) {
      callbacks.setTool("select");
      return;
    }

    canvas.setActiveObject(obj);
    obj.enterEditing();
    obj.selectAll();
    callbacks.setTool("select"); // so they can move it afterwards
    return;
  }

  // Empty space — spawn a new text box. Guard against an invisible
  // (transparent) fill leaking in from a previously selected shape tool.
  const fill =
    !style.fill.current || style.fill.current === "transparent"
      ? (TOOL_DEFAULTS.text?.fill ?? TEXT_DEFAULT_FILL)
      : style.fill.current;

  const textNode = new Textbox("", {
    left: pointer.x,
    top: pointer.y,
    width: TEXT_DEFAULT_WIDTH, // initial width before wrapping
    fontSize: TEXT_DEFAULT_FONT_SIZE,
    fill,
    fontFamily: "sans-serif",
    selectable: true,
    objectCaching: false, // prevents blurring during live typing
  }) as FabricObj;

  textNode.shapeId = newShapeId();
  canvas.add(textNode);
  canvas.setActiveObject(textNode);
  textNode.enterEditing();

  emit.createShape(textNode);
  callbacks.setTool("select");
}
