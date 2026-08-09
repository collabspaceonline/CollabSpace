import { FabricImage } from "fabric";
import {
  IMAGE_MAX_SIDE,
  IMAGE_PLACE_MAX_SIDE,
  IMAGE_QUALITY,
  MAX_IMAGE_BYTES,
} from "../constants";
import type { WhiteboardEmitters } from "../net/emitters";
import type { FabricCanvasLike, FabricObj } from "../types";
import { compressImageDataUrl } from "./image";
import { newShapeId } from "./shape";

/**
 * Toolbar actions. Each takes the canvas explicitly and returns nothing —
 * the component re-reads the object count afterwards.
 */

export function deleteSelected(canvas: FabricCanvasLike, emit: WhiteboardEmitters): void {
  canvas.getActiveObjects().forEach((obj: FabricObj) => {
    const id = obj.shapeId;
    canvas.remove(obj);
    if (id) emit.deleteShape(id);
  });
  canvas.discardActiveObject();
  canvas.renderAll();
}

export function clearBoard(canvas: FabricCanvasLike, emit: WhiteboardEmitters): void {
  canvas.clear();
  canvas.renderAll();
  emit.clearBoard();
}

/** Run a mutation over the current selection and broadcast each change. */
export function applyToSelection(
  canvas: FabricCanvasLike,
  emit: WhiteboardEmitters,
  mutate: (obj: FabricObj) => void,
): void {
  const objs = canvas.getActiveObjects() as FabricObj[];
  if (!objs.length) return;
  objs.forEach(mutate);
  canvas.renderAll();
  objs.forEach((obj) => {
    if (obj.shapeId) emit.liveUpdate(obj);
  });
}

/**
 * Read a file, downscale it, and drop it at the centre of the viewport.
 * The compressed data URL rides along inside the shape, so it must stay well
 * under the server's Socket.IO buffer limit.
 */
export function importImage(
  canvas: FabricCanvasLike,
  emit: WhiteboardEmitters,
  file: File,
  onDone: () => void,
): void {
  if (!file.type.startsWith("image/")) return;
  if (file.size > MAX_IMAGE_BYTES) {
    alert("Image is too large. Please choose an image under 5 MB.");
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result as string;
    if (!dataUrl) return;
    try {
      const compressed = await compressImageDataUrl(dataUrl, IMAGE_MAX_SIDE, IMAGE_QUALITY);
      const img = (await FabricImage.fromURL(compressed, { crossOrigin: "anonymous" })) as FabricObj;

      // Centre of the current viewport, in world coordinates
      const vt = canvas.viewportTransform!;
      const zoom = canvas.getZoom();
      const cx = (canvas.width! / 2 - vt[4]) / zoom;
      const cy = (canvas.height! / 2 - vt[5]) / zoom;

      // Scale down large images so they fit comfortably in view
      const scale = Math.min(1, IMAGE_PLACE_MAX_SIDE / Math.max(img.width || 1, img.height || 1));

      img.set({
        left: cx - ((img.width || 0) * scale) / 2,
        top: cy - ((img.height || 0) * scale) / 2,
        scaleX: scale,
        scaleY: scale,
        selectable: true,
      });
      img.shapeId = newShapeId();
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
      emit.createShape(img);
      onDone();
    } catch (err) {
      console.error("Failed to import image", err);
    }
  };
  reader.readAsDataURL(file);
}
