"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";
import {
  Canvas as FabricCanvas,
  Rect as FabricRect,
  Ellipse as FabricEllipse,
  Line as FabricLine,
  Path as FabricPath,
  Point as FabricPoint,
  PencilBrush,
  util as fabricUtil,
} from "fabric";

type ToolType = "select" | "rect" | "circle" | "line" | "arrow" | "pen" | "eraser";

/** Build an SVG path string for a line with an open arrowhead at (x2, y2). */
function makeArrowPath(x1: number, y1: number, x2: number, y2: number, headLen = 16): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const hx1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
  const hy1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
  const hx2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
  const hy2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
  return `M ${x1} ${y1} L ${x2} ${y2} M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`;
}

// Virtual canvas size — users cannot pan completely outside this boundary
const VIRTUAL_W = 5000;
const VIRTUAL_H = 5000;

function fabricObjToShape(obj: any & { shapeId?: string }): any {
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

interface WhiteboardProps {
  socket: Socket;
}

export default function Whiteboard({ socket }: WhiteboardProps) {
  const [tool, setTool] = useState<ToolType>("select");
  const [fillColor, setFillColor] = useState("#4f8ef7");
  const [strokeColor, setStrokeColor] = useState("#1a1a2e");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [opacity, setOpacity] = useState(1);
  const [wbVersion, setWbVersion] = useState(0);
  const [shapeCount, setShapeCount] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);

  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<any | null>(null);
  const toolRef = useRef<ToolType>("select");
  const fillColorRef = useRef(fillColor);
  const strokeColorRef = useRef(strokeColor);
  const strokeWidthRef = useRef(strokeWidth);
  const opacityRef = useRef(opacity);
  const suppressEmitRef = useRef(false);

  const isDrawingShapeRef = useRef(false);
  const isErasingRef = useRef(false);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const activeShapeRef = useRef<any | null>(null);
  const lineRef = useRef<any | null>(null);

  // Pan & live-sync state
  const isPanningRef = useRef(false);
  const lastPanRef = useRef({ x: 0, y: 0 });
  const liveThrottleRef = useRef(0);

  // Keep refs in sync with state
  useEffect(() => { toolRef.current = tool; applyFabricMode(); }, [tool]);
  useEffect(() => { fillColorRef.current = fillColor; }, [fillColor]);
  useEffect(() => { strokeColorRef.current = strokeColor; }, [strokeColor]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { opacityRef.current = opacity; }, [opacity]);

  // ─── Apply Fabric.js drawing mode based on active tool ─────────────────────
  const applyFabricMode = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    fc.isDrawingMode = false;
    fc.selection = true;
    fc.defaultCursor = "default";

    switch (toolRef.current) {
      case "pen":
        const brush = new PencilBrush(fc);
        brush.color = fillColorRef.current;
        brush.width = strokeWidthRef.current;
        fc.freeDrawingBrush = brush;
        fc.isDrawingMode = true;
        break;
      case "eraser":
        fc.selection = false;
        fc.defaultCursor = "cell";
        fc.discardActiveObject();
        break;
      case "select":
        break;
      default:
        fc.selection = false;
        fc.defaultCursor = "crosshair";
        fc.discardActiveObject();
        break;
    }
    fc.renderAll();
  }, []);

  // ─── Emit helpers ───────────────────────────────────────────────────────────
  const emitCreate = useCallback((obj: any & { shapeId?: string }) => {
    if (!socket || suppressEmitRef.current) return;
    socket.emit("wb:createShape", { shape: fabricObjToShape(obj) });
  }, [socket]);

  // Live update during drawing — no clientVersion so server skips version gate
  const emitUpdate = useCallback((obj: any & { shapeId?: string }) => {
    if (!socket || suppressEmitRef.current || !obj?.shapeId) return;
    socket.emit("wb:updateShape", { id: obj.shapeId, changes: fabricObjToShape(obj) });
  }, [socket]);

  const emitDelete = useCallback((id: string) => {
    if (!socket || suppressEmitRef.current) return;
    socket.emit("wb:deleteShape", { id });
  }, [socket]);

  // ─── Find a Fabric object by shapeId ───────────────────────────────────────
  const findByShapeId = (id: string): (any & { shapeId?: string }) | undefined => {
    return (fabricRef.current?.getObjects() as any[]).find((o: any) => o.shapeId === id);
  };

  // ─── Initialise Fabric canvas ───────────────────────────────────────────────
  const initFabric = useCallback(() => {
    if (fabricRef.current) return;
    const el = canvasElRef.current;
    if (!el) return;

    const parent = el.parentElement!;
    const fc = new FabricCanvas(el, {
      width: parent.clientWidth,
      height: parent.clientHeight,
      backgroundColor: "transparent",
      selection: true,
      preserveObjectStacking: true,
      // Gives a 15px radius cushion to clicking, making thin lines easy to erase
      targetFindTolerance: 15,
    });
    fabricRef.current = fc;

    // ── Clamp viewport so the user never pans fully outside the virtual canvas ─
    // Ensures at least 1 px of the VIRTUAL_W×VIRTUAL_H world is always on screen.
    const clampVt = () => {
      const vt = fc.viewportTransform!;
      const zoom = fc.getZoom();
      // vt[4] is the X screen offset of world origin. Clamp so:
      //   right edge of virtual canvas ≥ left of screen  →  vt[4] ≥ -VIRTUAL_W*zoom
      //   left  edge of virtual canvas ≤ right of screen →  vt[4] ≤ fc.width
      vt[4] = Math.min(Math.max(vt[4], -VIRTUAL_W * zoom), fc.width!);
      vt[5] = Math.min(Math.max(vt[5], -VIRTUAL_H * zoom), fc.height!);
    };

    // ── Infinite panning grid ────────────────────────────────────────────────
    const drawGrid = () => {
      const ctx = fc.lowerCanvasEl.getContext("2d")!;
      const w = fc.width!;
      const h = fc.height!;
      const vt = fc.viewportTransform!;
      const zoom = fc.getZoom();
      const cell = 40 * zoom;
      // Wrap pan offset so lines tile seamlessly across the infinite canvas
      const ox = vt[4] % cell;
      const oy = vt[5] % cell;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      for (let x = ox; x < w; x += cell) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = oy; y < h; y += cell) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.restore();
    };
    fc.on("after:render", drawGrid);

    // ── Minimap ──────────────────────────────────────────────────────────────
    // Runs on every after:render so the minimap stays in sync with the main canvas.
    const drawMinimap = () => {
      const mc = minimapRef.current;
      if (!mc) return;
      const ctx = mc.getContext("2d")!;
      const mw = mc.width;   // physical canvas pixels (set via width/height attrs)
      const mh = mc.height;
      const sx = mw / VIRTUAL_W;  // world → minimap scale
      const sy = mh / VIRTUAL_H;

      ctx.clearRect(0, 0, mw, mh);

      // Draw each shape as a filled rectangle at its bounding box
      fc.getObjects().forEach((obj: any) => {
        const b = obj.getBoundingRect();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillRect(
          b.left  * sx,
          b.top   * sy,
          Math.max(b.width  * sx, 2),
          Math.max(b.height * sy, 2),
        );
      });

      // Draw the current viewport as a blue stroke rectangle.
      // Inverse of viewportTransform: screen (0,0)→(W,H) maps to world:
      //   worldX = (screenX - vt[4]) / zoom,  worldY = (screenY - vt[5]) / zoom
      const vt = fc.viewportTransform!;
      const zoom = fc.getZoom();
      const vpX = (-vt[4] / zoom) * sx;
      const vpY = (-vt[5] / zoom) * sy;
      const vpW = (fc.width!  / zoom) * sx;
      const vpH = (fc.height! / zoom) * sy;
      ctx.strokeStyle = "#4f8ef7";
      ctx.lineWidth = 2;
      ctx.strokeRect(vpX, vpY, vpW, vpH);
    };
    fc.on("after:render", drawMinimap);

    // ── Resize ──────────────────────────────────────────────────────────────
    const onResize = () => {
      fc.setDimensions({ width: parent.clientWidth, height: parent.clientHeight });
      fc.renderAll();
    };
    window.addEventListener("resize", onResize);

    // ── Scroll to zoom ───────────────────────────────────────────────────────
    fc.on("mouse:wheel", (opt) => {
      const we = opt.e as WheelEvent;
      let zoom = fc.getZoom() * (0.999 ** we.deltaY);
      zoom = Math.min(Math.max(zoom, 0.05), 20);
      fc.zoomToPoint(new FabricPoint(we.offsetX, we.offsetY), zoom);
      clampVt();
      we.preventDefault();
      we.stopPropagation();
    });

    // ── Mouse down ──────────────────────────────────────────────────────────
    fc.on("mouse:down", (opt) => {
      const me = opt.e as MouseEvent;
      // Alt key or middle mouse button → begin pan
      if (me.altKey || me.button === 1) {
        isPanningRef.current = true;
        lastPanRef.current = { x: me.clientX, y: me.clientY };
        fc.upperCanvasEl.style.cursor = "grabbing";
        return;
      }

      const t = toolRef.current;
      if (t === "select" || t === "pen") return;

      // ERASER: use findTarget so it hits shapes even with selection disabled
      if (t === "eraser") {
        isErasingRef.current = true;
        const target = fc.findTarget(opt.e) as (any & { shapeId?: string }) | null;
        if (target && target.shapeId) {
          const id = target.shapeId;
          fc.remove(target);
          if (id) emitDelete(id);
          setShapeCount(fc.getObjects().length);
        }
        return;
      }

      const pointer = fc.getScenePoint(opt.e);

      // Rect / circle / line — start drag
      isDrawingShapeRef.current = true;
      originRef.current = { x: pointer.x, y: pointer.y };

      if (t === "rect") {
        const r = new FabricRect({
          left: pointer.x, top: pointer.y,
          width: 0, height: 0,
          fill: fillColorRef.current,
          stroke: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
          opacity: opacityRef.current,
          selectable: false,
        }) as any;
        r.shapeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fc.add(r);
        activeShapeRef.current = r;
        emitCreate(r);
      } else if (t === "circle") {
        const c = new FabricEllipse({
          left: pointer.x, top: pointer.y,
          rx: 0, ry: 0,
          fill: fillColorRef.current,
          stroke: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
          opacity: opacityRef.current,
          selectable: false,
        }) as any;
        c.shapeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fc.add(c);
        activeShapeRef.current = c;
        emitCreate(c);
      } else if (t === "line" || t === "arrow") {
        // Arrow uses a live line preview; on mouse:up it swaps for a Path.
        const l = new FabricLine([pointer.x, pointer.y, pointer.x, pointer.y], {
          stroke: fillColorRef.current,
          strokeWidth: strokeWidthRef.current,
          opacity: opacityRef.current,
          selectable: false,
          objectCaching: false,
        }) as any;
        l.shapeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fc.add(l);
        lineRef.current = l;
        activeShapeRef.current = l;
        emitCreate(l);
      }
    });

    // ── Mouse move ──────────────────────────────────────────────────────────
    fc.on("mouse:move", (opt) => {
      // Pan: shift viewport translate by mouse delta, then clamp to virtual bounds
      if (isPanningRef.current) {
        const me = opt.e as MouseEvent;
        const vt = fc.viewportTransform!;
        vt[4] += me.clientX - lastPanRef.current.x;
        vt[5] += me.clientY - lastPanRef.current.y;
        lastPanRef.current = { x: me.clientX, y: me.clientY };
        clampVt();
        fc.requestRenderAll();
        return;
      }

      const t = toolRef.current;

      // ERASER: Continuous Swipe-to-Erase Feature
      if (t === "eraser" && isErasingRef.current) {
        const target = fc.findTarget(opt.e) as (any & { shapeId?: string }) | null;
        if (target && target.shapeId) {
          const id = target.shapeId;
          fc.remove(target);
          if (id) emitDelete(id);
          setShapeCount(fc.getObjects().length);
        }
        return;
      }

      if (!isDrawingShapeRef.current || !originRef.current) return;
      const pointer = fc.getScenePoint(opt.e);
      const { x: ox, y: oy } = originRef.current;

      if (t === "rect" && activeShapeRef.current) {
        const r = activeShapeRef.current as any;
        r.set({
          left: Math.min(ox, pointer.x),
          top: Math.min(oy, pointer.y),
          width: Math.abs(pointer.x - ox),
          height: Math.abs(pointer.y - oy),
        });
        fc.renderAll();
      } else if (t === "circle" && activeShapeRef.current) {
        const c = activeShapeRef.current as any;
        c.set({
          left: Math.min(ox, pointer.x),
          top: Math.min(oy, pointer.y),
          rx: Math.abs(pointer.x - ox) / 2,
          ry: Math.abs(pointer.y - oy) / 2,
        });
        fc.renderAll();
      } else if ((t === "line" || t === "arrow") && lineRef.current) {
        const line = lineRef.current as any;
        line.x1 = originRef.current!.x;
        line.y1 = originRef.current!.y;
        line.x2 = pointer.x;
        line.y2 = pointer.y;
        line._setWidthHeight();
        line.setCoords();
        line.dirty = true;
        fc.renderAll();
      }

      // Throttled live sync so peers see the shape grow (~20 fps)
      const now = Date.now();
      if (now - liveThrottleRef.current >= 50 && activeShapeRef.current) {
        liveThrottleRef.current = now;
        emitUpdate(activeShapeRef.current);
      }
    });

    // ── Mouse up ────────────────────────────────────────────────────────────
    fc.on("mouse:up", () => {
      // End pan, restore cursor
      if (isPanningRef.current) {
        isPanningRef.current = false;
        fc.upperCanvasEl.style.cursor = "";
        applyFabricMode();
        return;
      }

      const t = toolRef.current;

      if (t === "eraser") {
        isErasingRef.current = false;
        return;
      }

      if (!isDrawingShapeRef.current) return;
      isDrawingShapeRef.current = false;
      originRef.current = null;

      const obj = activeShapeRef.current || lineRef.current;
      activeShapeRef.current = null;
      lineRef.current = null;
      if (!obj) return;

      if (t === "arrow") {
        // Replace the preview line with a finalized arrow Path.
        const lx1 = (obj as any).x1 as number;
        const ly1 = (obj as any).y1 as number;
        const lx2 = (obj as any).x2 as number;
        const ly2 = (obj as any).y2 as number;
        const oldId = (obj as any).shapeId as string;

        fc.remove(obj);
        emitDelete(oldId);

        // Skip degenerate zero-length arrows
        const dx = lx2 - lx1, dy = ly2 - ly1;
        if (Math.sqrt(dx * dx + dy * dy) >= 5) {
          const arrow = new FabricPath(makeArrowPath(lx1, ly1, lx2, ly2), {
            stroke: fillColorRef.current,
            fill: "",
            strokeWidth: strokeWidthRef.current,
            opacity: opacityRef.current,
            selectable: true,
            strokeLineCap: "round",
            strokeLineJoin: "round",
          }) as any;
          arrow.shapeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          fc.add(arrow);
          emitCreate(arrow);
        }
      } else {
        (obj as any).selectable = true;
        emitUpdate(obj);
      }
      setShapeCount(fc.getObjects().length);
    });

    // ── Path created (pen mode) ──────────────────────────────────────────────
    fc.on("path:created", (opt: any) => {
      const path = opt.path as (any & { shapeId?: string });
      path.shapeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      emitCreate(path);
      setShapeCount(fc.getObjects().length);
    });

    // ── Object modified (move / resize / rotate single OR multiple) ──────────
    fc.on("object:modified", (opt) => {
      const target = opt.target as any;
      if (!target) return;

      if (target.type === "activeSelection" || target.type === "group") {
        target.getObjects().forEach((obj: any) => {
          if (!obj.shapeId) return;

          // 1. Calculate the true global position
          const matrix = obj.calcTransformMatrix();
          const globalTransform = fabricUtil.qrDecompose(matrix);

          // 2. Export the base shape data
          const shape = fabricObjToShape(obj);

          // 3. OVERWRITE the relative coordinates
          shape.left = globalTransform.translateX;
          shape.top = globalTransform.translateY;
          shape.scaleX = globalTransform.scaleX;
          shape.scaleY = globalTransform.scaleY;
          shape.angle = globalTransform.angle;

          // 4. Emit absolute positioning
          socket?.emit("wb:updateShape", {
            id: obj.shapeId,
            changes: shape,
            clientVersion: obj.__version ?? 0,
          });
        });
      } else if (target.shapeId) {
        const shape = fabricObjToShape(target);
        socket?.emit("wb:updateShape", {
          id: target.shapeId,
          changes: shape,
          clientVersion: target.__version ?? 0,
        });
      }
    });

    // ── Selection state ──────────────────────────────────────────────────────
    fc.on("selection:created", () => setHasSelection(true));
    fc.on("selection:updated", () => setHasSelection(true));
    fc.on("selection:cleared", () => setHasSelection(false));

    applyFabricMode();
  }, [applyFabricMode, emitCreate, emitUpdate, emitDelete, socket]);

  // ─── Destroy Fabric canvas ──────────────────────────────────────────────────
  const destroyFabric = useCallback(() => {
    fabricRef.current?.dispose();
    fabricRef.current = null;
  }, []);

  // ─── Init on mount, destroy on unmount ─────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(initFabric, 0);
    return () => {
      clearTimeout(t);
      destroyFabric();
    };
  }, [initFabric, destroyFabric]);

  // ─── Fetch whiteboard state on mount ───────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    socket.emit("wb:getState", ({ shapes, version }: { shapes: any[]; version: number }) => {
      setWbVersion(version);
      setTimeout(() => {
        const fc = fabricRef.current;
        if (!fc || !shapes.length) return;
        suppressEmitRef.current = true;
        fc.loadFromJSON({ version: "5.3.0", objects: shapes.map(s => ({ ...s, shapeId: s.id })) }, () => {
          fc.getObjects().forEach((obj: any, i: number) => {
            (obj as any).shapeId = shapes[i]?.id;
          });
          fc.renderAll();
          setShapeCount(fc.getObjects().length);
          suppressEmitRef.current = false;
        });
      }, 50);
    });
  }, [socket]);

  // ─── Socket event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    socket.on("wb:shapeCreated", ({ shape }: { shape: any }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      if (findByShapeId(shape.id)) return;
      suppressEmitRef.current = true;
      (async () => {
        const objs: any[] = await fabricUtil.enlivenObjects([{ ...shape, shapeId: shape.id }]);
        objs.forEach(obj => {
          obj.shapeId = shape.id;
          obj.__version = shape.version ?? 0;
          fc.add(obj);
        });
        fc.renderAll();
        setShapeCount(fc.getObjects().length);
        suppressEmitRef.current = false;
      })();
    });

    socket.on("wb:shapeUpdated", ({ shape }: { shape: any }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      const obj = findByShapeId(shape.id);
      if (!obj) return;
      // If this is the shape we're actively drawing, only sync the server version
      // so object:modified has the right clientVersion later — don't overwrite local state.
      const isActivelyDrawing =
        (activeShapeRef.current as any)?.shapeId === shape.id ||
        (lineRef.current as any)?.shapeId === shape.id;
      if (isActivelyDrawing) {
        (obj as any).__version = shape.version ?? 0;
        return;
      }
      suppressEmitRef.current = true;
      if ((obj as any).type === "line" && shape.x1 != null) {
        // Apply absolute coords directly then call _setWidthHeight once,
        // avoiding the 4× partial-update problem from set().
        (obj as any).x1 = shape.x1;
        (obj as any).y1 = shape.y1;
        (obj as any).x2 = shape.x2;
        (obj as any).y2 = shape.y2;
        (obj as any)._setWidthHeight();
        if (shape.stroke) (obj as any).stroke = shape.stroke;
        if (shape.strokeWidth) (obj as any).strokeWidth = shape.strokeWidth;
        if (shape.opacity != null) (obj as any).opacity = shape.opacity;
      } else {
        obj.set({ ...shape });
      }
      (obj as any).__version = shape.version ?? 0;
      obj.setCoords();
      fc.renderAll();
      suppressEmitRef.current = false;
    });

    socket.on("wb:shapeDeleted", ({ id }: { id: string }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      const obj = findByShapeId(id);
      if (obj) { fc.remove(obj); fc.renderAll(); setShapeCount(fc.getObjects().length); }
    });

    socket.on("wb:boardCleared", () => {
      const fc = fabricRef.current;
      if (!fc) return;
      suppressEmitRef.current = true;
      fc.clear();
      fc.renderAll();
      setShapeCount(0);
      suppressEmitRef.current = false;
    });

    socket.on("wb:shapeConflict", ({ shape }: { shape: any }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      const obj = findByShapeId(shape.id);
      if (!obj) return;
      suppressEmitRef.current = true;
      obj.set({ ...shape });
      (obj as any).__version = shape.version ?? 0;
      obj.setCoords();
      fc.renderAll();
      suppressEmitRef.current = false;
    });

    return () => {
      socket.off("wb:shapeCreated");
      socket.off("wb:shapeUpdated");
      socket.off("wb:shapeDeleted");
      socket.off("wb:boardCleared");
      socket.off("wb:shapeConflict");
    };
  }, [socket]);

  // ─── Update pen brush when colors/width change ──────────────────────────────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || !fc.isDrawingMode) return;
    const liveBrush = new PencilBrush(fc);
    liveBrush.color = fillColor;
    liveBrush.width = strokeWidth;
    fc.freeDrawingBrush = liveBrush;
  }, [fillColor, strokeWidth]);

  // ─── Whiteboard actions ─────────────────────────────────────────────────────
  const deleteSelected = () => {
    const fc = fabricRef.current;
    if (!fc) return;
    const active = fc.getActiveObjects();
    active.forEach((obj: any) => {
      const id = (obj as any).shapeId;
      fc.remove(obj);
      if (id) emitDelete(id);
    });
    fc.discardActiveObject();
    fc.renderAll();
    setShapeCount(fc.getObjects().length);
    setHasSelection(false);
  };

  const clearBoard = () => {
    if (!confirm("Clear the whiteboard for everyone?")) return;
    const fc = fabricRef.current;
    if (!fc) return;
    fc.clear();
    fc.renderAll();
    setShapeCount(0);
    socket?.emit("wb:clearBoard");
  };

  // ─── Tool palette ───────────────────────────────────────────────────────────
  const tools: { id: ToolType; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: "↖", label: "Select / Move" },
    { id: "rect",   icon: "▭", label: "Rectangle" },
    { id: "circle", icon: "◯", label: "Circle / Ellipse" },
    { id: "line",  icon: "╱", label: "Line" },
    {
      id: "arrow",
      label: "Arrow",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="w-4 h-4">
          <line x1="5" y1="19" x2="19" y2="5" />
          <polyline points="9 5 19 5 19 15" />
        </svg>
      ),
    },
    { id: "pen",   icon: "✏", label: "Freehand Pen" },
    {
      id: "eraser",
      label: "Eraser",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="w-4 h-4">
          <path d="M20 20H7L3 16l10-10 7 7-2.5 2.5" />
          <path d="M6 11l7 7" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[#111320] border-b border-white/10 flex-wrap">
        {/* Tools */}
        <div className="flex gap-1 bg-white/5 rounded-lg p-1">
          {tools.map(t => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={t.label}
              className={`w-8 h-8 rounded-md text-sm font-bold transition-all flex items-center justify-center
                ${tool === t.id ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/30" : "text-white/50 hover:text-white hover:bg-white/10"}`}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-white/10" />

        {/* Fill color */}
        <label className="flex items-center gap-1.5 text-xs text-white/50">
          Fill
          <input type="color" value={fillColor} onChange={e => setFillColor(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer bg-transparent border border-white/20" />
        </label>

        {/* Stroke color */}
        <label className="flex items-center gap-1.5 text-xs text-white/50">
          Stroke
          <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer bg-transparent border border-white/20" />
        </label>

        {/* Stroke width */}
        <label className="flex items-center gap-1.5 text-xs text-white/50">
          Width
          <input type="range" min="1" max="12" value={strokeWidth}
            onChange={e => setStrokeWidth(Number(e.target.value))}
            className="w-20 accent-indigo-400" />
          <span className="text-white/30 w-3">{strokeWidth}</span>
        </label>

        {/* Opacity */}
        <label className="flex items-center gap-1.5 text-xs text-white/50">
          Opacity
          <input type="range" min="0.1" max="1" step="0.05" value={opacity}
            onChange={e => setOpacity(Number(e.target.value))}
            className="w-16 accent-indigo-400" />
        </label>

        <div className="flex-1" />

        {/* Fabric-powered actions */}
        {hasSelection && (
          <>
            <button
              onClick={() => { const fc = fabricRef.current; if (!fc) return; const objs = fc.getActiveObjects(); objs.forEach((o: any) => { (o as any).set({ opacity: Math.max(0.1, (o.opacity ?? 1) - 0.1) }); }); fc.renderAll(); }}
              className="px-2 py-1 rounded bg-white/5 text-white/50 text-xs hover:bg-white/10 transition-colors"
              title="Decrease opacity"
            >−α</button>
            <button
              onClick={() => { const fc = fabricRef.current; if (!fc) return; const objs = fc.getActiveObjects(); objs.forEach((o: any) => { (o as any).set({ opacity: Math.min(1, (o.opacity ?? 1) + 0.1) }); }); fc.renderAll(); }}
              className="px-2 py-1 rounded bg-white/5 text-white/50 text-xs hover:bg-white/10 transition-colors"
              title="Increase opacity"
            >+α</button>
            <button
              onClick={() => { const fc = fabricRef.current; if (!fc) return; const obj = fc.getActiveObject(); if (obj) fc.bringObjectToFront(obj); fc.renderAll(); }}
              className="px-2 py-1 rounded bg-white/5 text-white/50 text-xs hover:bg-white/10 transition-colors"
              title="Bring to front"
            >↑ Front</button>
            <button
              onClick={() => { const fc = fabricRef.current; if (!fc) return; const obj = fc.getActiveObject(); if (obj) fc.sendObjectToBack(obj); fc.renderAll(); }}
              className="px-2 py-1 rounded bg-white/5 text-white/50 text-xs hover:bg-white/10 transition-colors"
              title="Send to back"
            >↓ Back</button>
            <button onClick={deleteSelected}
              className="px-2 py-1 rounded bg-red-500/20 text-red-400 text-xs hover:bg-red-500/40 transition-colors">
              Delete
            </button>
          </>
        )}
        <button onClick={clearBoard}
          className="px-2 py-1 rounded bg-white/5 text-white/40 text-xs hover:bg-white/10 transition-colors">
          Clear All
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden bg-[#0a0c18]">
        <canvas ref={canvasElRef} className="absolute inset-0" />

        {/* Minimap */}
        <div className="absolute bottom-6 right-6 z-20 rounded-lg overflow-hidden shadow-xl border border-white/20 bg-[#0a0c18]/80 backdrop-blur-sm">
          <canvas
            ref={minimapRef}
            width={192}
            height={128}
            className="block"
            title="Minimap — blue rect is your current view"
          />
          <div className="absolute bottom-1 left-2 text-[9px] text-white/20 font-mono pointer-events-none select-none">
            5000 × 5000
          </div>
        </div>

        <div className="absolute bottom-3 right-4 text-[10px] text-white/20 font-mono pointer-events-none" style={{ bottom: "calc(128px + 2rem)" }}>
          v{wbVersion} · {shapeCount} obj
        </div>
      </div>
    </div>
  );
}
