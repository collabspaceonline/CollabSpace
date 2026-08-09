import type { FabricCanvasLike, FabricObj, Shape } from "../types";

/** Stable id attached to every object as `shapeId` and shared across clients. */
export function newShapeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function fabricObjToShape(obj: FabricObj): Shape {
  const json = obj.toObject(["shapeId"]);
  // FabricLine.toObject() uses calcLinePoints() which returns coords relative
  // to the object center. Override with the real absolute coordinates so the
  // server stores world-space values that can be applied back correctly.
  if (obj.type === "line") {
    json.x1 = obj.x1;
    json.y1 = obj.y1;
    json.x2 = obj.x2;
    json.y2 = obj.y2;
  }
  return { ...json, id: obj.shapeId };
}

export function findByShapeId(canvas: FabricCanvasLike | null, id: string): FabricObj | undefined {
  if (!canvas) return undefined;
  return (canvas.getObjects() as FabricObj[]).find((o: FabricObj) => o.shapeId === id);
}

export function isTextObject(obj: FabricObj): boolean {
  return obj?.type === "textbox" || obj?.type === "i-text";
}
