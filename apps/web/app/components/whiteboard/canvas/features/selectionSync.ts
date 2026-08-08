import type { CanvasContext } from "../context";

/**
 * Keeps the React toolbar in step with the canvas selection: shows the
 * selection-only buttons and loads the selected object's style into the
 * colour / width / opacity inputs.
 */
export function registerSelectionSync(ctx: CanvasContext): void {
  const { canvas, callbacks } = ctx;

  const onSelect = () => {
    callbacks.setHasSelection(true);
    const sel = canvas.getActiveObjects();
    if (sel.length === 1) callbacks.syncStyleFromObject(sel[0]);
  };

  canvas.on("selection:created", onSelect);
  canvas.on("selection:updated", onSelect);
  canvas.on("selection:cleared", () => callbacks.setHasSelection(false));
}
