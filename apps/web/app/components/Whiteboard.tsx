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
  Textbox,
  Shadow,
  FabricImage,
} from "fabric";

type ToolType = "select" | "rect" | "circle" | "line" | "arrow" | "pen" | "eraser" | "text";

// Function to spawn a new Textbox
function createLiveTextbox(canvas: any, pointer: { x: number, y: number }, defaultText: string = "Type here...") {
  const textId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  
  const textNode = new Textbox(defaultText, {
    left: pointer.x,
    top: pointer.y,
    width: 200, // Initial width before wrapping occurs
    fontSize: 24,
    fill: "#1a1a2e", // Your default strokeColor
    fontFamily: "sans-serif",
    selectable: true,
    objectCaching: false, // Prevents blurring during live typing
  }) as any;

  // Attach the custom ID property used in your architecture
  textNode.shapeId = textId;
  
  canvas.add(textNode);
  canvas.setActiveObject(textNode);
  textNode.enterEditing();
  textNode.selectAll();
  
  return textNode;
}

// Assuming 'broadcastPayload' is your function to send data over WebRTC/Sockets
// and 'myUserId' is the local user's socket.id
function setupLiveTextListeners(canvas: any, broadcastPayload: (data: any) => void, myUserId: string) {
  
  // 1. Lock the object when the user starts typing
  canvas.on('text:editing:entered', (e: any) => {
    const target = e.target;
    if (!target || !target.shapeId) return;

    broadcastPayload({
      event: 'lock_text',
      id: target.shapeId,
      userId: myUserId
    });
  });

  // 2. Broadcast the full string on every single keystroke
  canvas.on('text:changed', (e: any) => {
    const target = e.target;
    if (!target || !target.shapeId) return;

    // Send the entire text string and the width (to sync word-wrapping)
    broadcastPayload({
      event: 'update_text',
      id: target.shapeId,
      text: target.text,
      width: target.width 
    });
  });

  // 3. Unlock the object when the user clicks away
  canvas.on('text:editing:exited', (e: any) => {
    const target = e.target;
    if (!target || !target.shapeId) return;

    broadcastPayload({
      event: 'unlock_text',
      id: target.shapeId
    });
  });
}

function handleIncomingTextData(canvas: any, payload: any) {
  if (!canvas) return;

  // Helper function to find the Fabric object by your custom shapeId
  const getObjectById = (id: string) => {
    return canvas.getObjects().find((obj: any) => obj.shapeId === id);
  };

  const target = getObjectById(payload.id);
  
  // Edge Case: The object hasn't rendered on this client yet. 
  // In a robust system, you might want to queue this or request a state sync.
  if (!target) return; 

  switch (payload.event) {
    case 'lock_text':
      // Lock the object so the local user cannot edit it
      target.set({
        selectable: false,
        evented: false,
        // Visual cue: Add a red glow to show someone else is editing
        shadow: new Shadow({
          color: 'rgba(234, 67, 53, 0.6)', 
          blur: 10,
          offsetX: 0,
          offsetY: 0
        })
      });
      target.dirty = true;
      canvas.requestRenderAll();
      break;

    case 'update_text':
      // Apply the exact string and width to maintain word-wrapping parity
      target.set({
        text: payload.text,
        width: payload.width
      });
      target.dirty = true;
      canvas.requestRenderAll();
      break;

    case 'unlock_text':
      // Restore standard interactivity and remove the visual lock cue
      target.set({
        selectable: true,
        evented: true,
        shadow: null
      });
      target.dirty = true;
      canvas.requestRenderAll();
      break;
  }
}

/** Downscale an image data URL to at most `maxSide` px on the longest edge,
 *  then re-encode as JPEG so the payload stays small enough to broadcast. */
function compressImageDataUrl(dataUrl: string, maxSide: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const imgEl = new Image();
    imgEl.onload = () => {
      const longest = Math.max(imgEl.width, imgEl.height);
      const scale = longest > maxSide ? maxSide / longest : 1;
      const w = Math.round(imgEl.width * scale);
      const h = Math.round(imgEl.height * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(imgEl, 0, 0, w, h);
      // PNGs with transparency become opaque when exported as JPEG; for small
      // PNGs that's fine here since we only care about image imports, not UI.
      resolve(c.toDataURL("image/jpeg", quality));
    };
    imgEl.onerror = reject;
    imgEl.src = dataUrl;
  });
}

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

/** Derive a stable HSL colour from a socket ID string. */
function cursorColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${((hash % 360) + 360) % 360}, 70%, 60%)`;
}

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
  theme?: "light" | "dark";
}

export default function Whiteboard({ socket, theme = "dark" }: WhiteboardProps) {
  const [tool, setTool] = useState<ToolType>("select");
  const [fillColor, setFillColor] = useState("#4f8ef7");
  const [strokeColor, setStrokeColor] = useState("#1a1a2e");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [opacity, setOpacity] = useState(1);
  const [wbVersion, setWbVersion] = useState(0);
  const [shapeCount, setShapeCount] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, { x: number; y: number }>>({});

  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const cursorContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const cursorThrottleRef = useRef(0);

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
  // NOTE: These are only called from direct user actions, never from remote
  // change handlers, so they must NOT check suppressEmitRef (which guards
  // against feedback loops when applying remote state).
  const emitCreate = useCallback((obj: any & { shapeId?: string }) => {
    if (!socket) return;
    socket.emit("wb:createShape", { shape: fabricObjToShape(obj) });
  }, [socket]);

  // Live update during drawing — no clientVersion so server skips version gate
  const emitUpdate = useCallback((obj: any & { shapeId?: string }) => {
    if (!socket || !obj?.shapeId) return;
    socket.emit("wb:updateShape", { id: obj.shapeId, changes: fabricObjToShape(obj) });
  }, [socket]);

  const emitDelete = useCallback((id: string) => {
    if (!socket) return;
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

      const vt = fc.viewportTransform!;
      const zoom = fc.getZoom();

      // Draw each shape as a filled rectangle at its bounding box.
      // getBoundingRect() returns screen-space coords — convert to world first.
      fc.getObjects().forEach((obj: any) => {
        const b = obj.getBoundingRect();
        const wl = (b.left - vt[4]) / zoom;
        const wt = (b.top  - vt[5]) / zoom;
        const ww = b.width  / zoom;
        const wh = b.height / zoom;
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillRect(
          wl * sx,
          wt * sy,
          Math.max(ww * sx, 2),
          Math.max(wh * sy, 2),
        );
      });

      // Draw the current viewport as a blue stroke rectangle.
      const vpX = (-vt[4] / zoom) * sx;
      const vpY = (-vt[5] / zoom) * sy;
      const vpW = (fc.width!  / zoom) * sx;
      const vpH = (fc.height! / zoom) * sy;
      ctx.strokeStyle = "#4f8ef7";
      ctx.lineWidth = 2;
      ctx.strokeRect(vpX, vpY, vpW, vpH);
    };
    fc.on("after:render", drawMinimap);

    // ── Sync cursor overlay transform with Fabric viewport ───────────────
    const syncCursorOverlay = () => {
      const container = cursorContainerRef.current;
      if (!container) return;
      const vt = fc.viewportTransform!;
      container.style.transform = `matrix(${vt[0]},${vt[1]},${vt[2]},${vt[3]},${vt[4]},${vt[5]})`;
    };
    fc.on("after:render", syncCursorOverlay);

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

      // ERASER: erase object under cursor on click / drag
      if (t === "eraser") {
        isErasingRef.current = true;
        const target = (opt as any).target as (any & { shapeId?: string }) | undefined;
        if (target?.shapeId) {
          const id = target.shapeId;
          fc.remove(target);
          emitDelete(id);
          fc.requestRenderAll();
          setShapeCount(fc.getObjects().length);
        }
        return;
      }

      const pointer = fc.getScenePoint(opt.e);

      // Spawning a Textbox
      if (t === "text") {
        // ✅ ADD THIS: Check if the user clicked on an existing text box first
        let clickedExistingText = false;
        const objects = fc.getObjects();
        
        // Loop backwards to check the top-most objects first
        for (let i = objects.length - 1; i >= 0; i--) {
          const obj = objects[i];
          
          // ✅ FIX 1: Ensure obj actually exists to satisfy the "possibly undefined" error
          if (!obj) continue;

          if ((obj.type === "textbox" || obj.type === "i-text") && obj.containsPoint(pointer)) {

            // ✅ FIX 1: Prevent dual-editing! If it's locked by someone else, stop here.
            if (obj.selectable === false) {
              setTool("select"); // Optional: switch to select tool anyway
              return; 
            }
            
            // ✅ FIX 2: Cast the object to 'any' so TypeScript stops complaining about missing text methods
            const textObj = obj as any; 

            fc.setActiveObject(textObj);
            textObj.enterEditing();
            textObj.selectAll();
            
            // Switch back to the select tool so they can move it later
            setTool("select"); 
            clickedExistingText = true;
            break;
          }
        }

        // If they clicked existing text, stop here. Don't spawn a new one.
        if (clickedExistingText) return;


        // ✅ Original code: If they clicked empty space, spawn a new one
        const textNode = new Textbox("", {
          left: pointer.x, 
          top: pointer.y,
          width: 200, // Initial width before wrapping
          fontSize: 24,
          fill: fillColorRef.current,
          fontFamily: "sans-serif",
          selectable: true,
          objectCaching: false, 
        }) as any;
        
        textNode.shapeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fc.add(textNode);
        
        fc.setActiveObject(textNode);
        textNode.enterEditing();
        
        emitCreate(textNode);
        setTool("select"); 
        return;
      }

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

    // ── Live Text Sync (Sender) ──────────────────────────────────────────────
    fc.on("text:changed", (opt: any) => {
      const target = opt.target;
      if (!target || !target.shapeId) return;

      // Fire the new text string through your existing update pipeline!
      socket?.emit("wb:updateShape", {
        id: target.shapeId,
        changes: { text: target.text, width: target.width },
        clientVersion: target.__version ?? 0 
      });
    });

    fc.on("text:editing:entered", (opt: any) => {
      const target = opt.target;
      if (!target || !target.shapeId) return;
      socket?.emit("wb:lockShape", { id: target.shapeId, userId: socket?.id });
    });

    fc.on("text:editing:exited", (opt: any) => {
      const target = opt.target;
      if (!target || !target.shapeId) return;
      socket?.emit("wb:unlockShape", { id: target.shapeId });
    });

    // ── Mouse move ──────────────────────────────────────────────────────────
    fc.on("mouse:move", (opt) => {
      // Emit live cursor position to other users (throttled ~30fps)
      {
        const now = Date.now();
        if (now - cursorThrottleRef.current >= 33) {
          cursorThrottleRef.current = now;
          const cp = fc.getScenePoint(opt.e);
          socket?.emit("wb:cursorMove", { x: cp.x, y: cp.y });
        }
      }

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
        const target = (opt as any).target as (any & { shapeId?: string }) | undefined;
        if (target?.shapeId && target.canvas) {
          const id = target.shapeId;
          fc.remove(target);
          emitDelete(id);
          fc.requestRenderAll();
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

    // ── Emit cursor leave when mouse exits canvas ────────────────────────
    fc.on("mouse:out", () => { socket?.emit("wb:cursorLeave"); });

    // ── Selection state — sync toolbar from selected object ─────────────────
    const syncToolbarFrom = (obj: any) => {
      if (!obj) return;
      if (obj.type === "rect" || obj.type === "ellipse") {
        if (obj.fill && typeof obj.fill === "string") setFillColor(obj.fill);
        if (obj.stroke && typeof obj.stroke === "string") setStrokeColor(obj.stroke);
      } else {
        // line, path (pen/arrow) — primary colour lives in stroke
        if (obj.stroke && typeof obj.stroke === "string") setFillColor(obj.stroke);
      }
      if (obj.strokeWidth != null) setStrokeWidth(obj.strokeWidth);
      if (obj.opacity != null) setOpacity(obj.opacity);
    };
    fc.on("selection:created", () => {
      setHasSelection(true);
      const sel = fc.getActiveObjects();
      if (sel.length === 1) syncToolbarFrom(sel[0]);
    });
    fc.on("selection:updated", () => {
      setHasSelection(true);
      const sel = fc.getActiveObjects();
      if (sel.length === 1) syncToolbarFrom(sel[0]);
    });
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

      // Lines need special handling: toObject() serialises relative coords
      // but the server stores absolute x1/y1/x2/y2 — enlivenObjects would
      // double-offset them via left/top. Create the line directly instead.
      if (shape.type === "line") {
        const l = new FabricLine([shape.x1, shape.y1, shape.x2, shape.y2], {
          stroke: shape.stroke,
          strokeWidth: shape.strokeWidth,
          opacity: shape.opacity ?? 1,
          selectable: true,
          objectCaching: false,
        }) as any;
        l.shapeId = shape.id;
        l.__version = shape.version ?? 0;
        fc.add(l);
        fc.renderAll();
        setShapeCount(fc.getObjects().length);
        suppressEmitRef.current = false;
        return;
      }

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

      // NEW: Check if the local user is currently typing in this exact text box
      const isActivelyTyping = (obj as any).isEditing === true;

      if (isActivelyDrawing || isActivelyTyping) {
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
        // ✅ FIX: Strip out the permanent 'type' and 'version' properties
        const { type, version, ...safeShape } = shape;
        obj.set(safeShape);
      }

      // ✅ FIX 2: Ensure the text property explicitly updates and forces a visual redraw
      if ((obj.type === "textbox" || obj.type === "i-text") && shape.text !== undefined) {
        (obj as any).text = shape.text;
        obj.dirty = true;
        fc.requestRenderAll(); // requestRenderAll is much more reliable for live syncs
      }

      (obj as any).__version = shape.version ?? 0;
      (obj as any).dirty = true;   // invalidate object cache so Fabric redraws it
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

    socket.on("wb:shapeLocked", ({ id, userId }: { id: string; userId: string }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      const obj = findByShapeId(id);
      if (!obj) return;

      suppressEmitRef.current = true;
      obj.set({
        selectable: false,
        evented: false,
        shadow: new Shadow({
          color: 'rgba(234, 67, 53, 0.6)', 
          blur: 10,
          offsetX: 0,
          offsetY: 0
        })
      });
      fc.renderAll();
      suppressEmitRef.current = false;
    });

    socket.on("wb:shapeUnlocked", ({ id }: { id: string }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      const obj = findByShapeId(id);
      if (!obj) return;

      suppressEmitRef.current = true;
      obj.set({
        selectable: true,
        evented: true,
        shadow: null
      });
      fc.renderAll();
      suppressEmitRef.current = false;
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
      // ✅ FIX: Strip out the permanent 'type' and 'version' properties
      const { type, version, ...safeShape } = shape;
      obj.set(safeShape);

      // ✅ FIX 2: Ensure the text property explicitly updates and forces a visual redraw
      if ((obj.type === "textbox" || obj.type === "i-text") && shape.text !== undefined) {
        (obj as any).text = shape.text;
        obj.dirty = true;
        fc.requestRenderAll(); // requestRenderAll is much more reliable for live syncs
      }

      (obj as any).__version = shape.version ?? 0;
      obj.setCoords();
      fc.renderAll();
      suppressEmitRef.current = false;
    });

    // ── Live cursors from other users ──────────────────────────────────────
    socket.on("wb:cursorMove", ({ socketId, x, y }: { socketId: string; x: number; y: number }) => {
      setRemoteCursors(prev => ({ ...prev, [socketId]: { x, y } }));
    });

    socket.on("wb:cursorLeave", ({ socketId }: { socketId: string }) => {
      setRemoteCursors(prev => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    });

    socket.on("peer-disconnected", ({ socketId }: { socketId: string }) => {
      setRemoteCursors(prev => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    });

    return () => {
      socket.off("wb:shapeCreated");
      socket.off("wb:shapeUpdated");
      socket.off("wb:shapeDeleted");
      socket.off("wb:shapeLocked");
      socket.off("wb:shapeUnlocked");
      socket.off("wb:boardCleared");
      socket.off("wb:shapeConflict");
      socket.off("wb:cursorMove");
      socket.off("wb:cursorLeave");
      socket.off("peer-disconnected");
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

  const importImage = (file: File) => {
    const fc = fabricRef.current;
    if (!fc || !file.type.startsWith("image/")) return;

    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      alert("Image is too large. Please choose an image under 5 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      if (!dataUrl) return;
      try {
        // Downscale + recompress via an offscreen canvas so the payload we
        // broadcast (embedded as `src`) stays well under Socket.IO's buffer limit.
        const compressed = await compressImageDataUrl(dataUrl, 1200, 0.85);

        const img = await FabricImage.fromURL(compressed, { crossOrigin: "anonymous" }) as any;

        // Drop the image at the center of the current viewport
        const vt = fc.viewportTransform!;
        const zoom = fc.getZoom();
        const cx = (fc.width! / 2 - vt[4]) / zoom;
        const cy = (fc.height! / 2 - vt[5]) / zoom;

        // Scale down large images so they fit comfortably in view
        const maxSide = 400;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));

        img.set({
          left: cx - ((img.width || 0) * scale) / 2,
          top: cy - ((img.height || 0) * scale) / 2,
          scaleX: scale,
          scaleY: scale,
          selectable: true,
        });
        img.shapeId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fc.add(img);
        fc.setActiveObject(img);
        fc.renderAll();
        emitCreate(img);
        setShapeCount(fc.getObjects().length);
      } catch (err) {
        console.error("Failed to import image", err);
      }
    };
    reader.readAsDataURL(file);
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

  // ─── Toolbar → selection sync helpers ─────────────────────────────────────
  const applyToSelection = (setter: (obj: any) => void) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const objs = fc.getActiveObjects();
    if (!objs.length) return;
    objs.forEach((obj: any) => { setter(obj); });
    fc.renderAll();
    objs.forEach((obj: any) => { if (obj.shapeId) emitUpdate(obj); });
  };

  const handleFillColor = (val: string) => {
    setFillColor(val);
    applyToSelection((obj) => {
      if (obj.type === "rect" || obj.type === "ellipse") {
        obj.set({ fill: val });
      } else {
        obj.set({ stroke: val });
      }
    });
  };

  const handleStrokeColor = (val: string) => {
    setStrokeColor(val);
    applyToSelection((obj) => {
      if (obj.type === "rect" || obj.type === "ellipse") {
        obj.set({ stroke: val });
      }
    });
  };

  const handleStrokeWidth = (val: number) => {
    setStrokeWidth(val);
    applyToSelection((obj) => obj.set({ strokeWidth: val }));
  };

  const handleOpacity = (val: number) => {
    setOpacity(val);
    applyToSelection((obj) => obj.set({ opacity: val }));
  };

  // ─── Tool palette ───────────────────────────────────────────────────────────
  const tools: { id: ToolType; icon: React.ReactNode; label: string }[] = [
    { id: "select", icon: "↖", label: "Select / Move" },
    { id: "text",   icon: "T", label: "Text" },
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
      <div className="flex items-center gap-2 px-4 py-2 flex-wrap" style={{ background: "var(--toolbar-bg)", borderBottom: "1px solid var(--border)" }}>
        {/* Tools */}
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--badge-bg)" }}>
          {tools.map(t => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={t.label}
              className="w-8 h-8 rounded-md text-sm font-bold transition-all flex items-center justify-center"
              style={tool === t.id
                ? { background: "var(--toolbar-btn-active)", color: "var(--toolbar-btn-active-text)", boxShadow: "var(--shadow)" }
                : { color: "var(--text-tertiary)" }}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <div className="w-px h-6" style={{ background: "var(--border)" }} />

        {/* Fill color */}
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          Fill
          <input type="color" value={fillColor} onChange={e => handleFillColor(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer bg-transparent border" style={{ borderColor: "var(--border)" }} />
        </label>

        {/* Stroke color */}
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          Stroke
          <input type="color" value={strokeColor} onChange={e => handleStrokeColor(e.target.value)}
            className="w-7 h-7 rounded cursor-pointer bg-transparent border" style={{ borderColor: "var(--border)" }} />
        </label>

        {/* Stroke width */}
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          Width
          <input type="range" min="1" max="12" value={strokeWidth}
            onChange={e => handleStrokeWidth(Number(e.target.value))}
            className="w-20 accent-indigo-400" />
          <span className="w-3" style={{ color: "var(--text-tertiary)" }}>{strokeWidth}</span>
        </label>

        {/* Opacity */}
        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          Opacity
          <input type="range" min="0.1" max="1" step="0.05" value={opacity}
            onChange={e => handleOpacity(Number(e.target.value))}
            className="w-16 accent-indigo-400" />
        </label>

        <div className="flex-1" />

        {/* Fabric-powered actions */}
        {hasSelection && (
          <>
            <button
              onClick={() => { const fc = fabricRef.current; if (!fc) return; const objs = fc.getActiveObjects(); objs.forEach((o: any) => { (o as any).set({ opacity: Math.max(0.1, (o.opacity ?? 1) - 0.1) }); }); fc.renderAll(); }}
              className="px-2 py-1 rounded text-xs transition-colors" style={{ background: "var(--badge-bg)", color: "var(--text-secondary)" }}
              title="Decrease opacity"
            >−α</button>
            <button
              onClick={() => { const fc = fabricRef.current; if (!fc) return; const objs = fc.getActiveObjects(); objs.forEach((o: any) => { (o as any).set({ opacity: Math.min(1, (o.opacity ?? 1) + 0.1) }); }); fc.renderAll(); }}
              className="px-2 py-1 rounded text-xs transition-colors" style={{ background: "var(--badge-bg)", color: "var(--text-secondary)" }}
              title="Increase opacity"
            >+α</button>
            <button
              onClick={() => { const fc = fabricRef.current; if (!fc) return; const obj = fc.getActiveObject(); if (obj) fc.bringObjectToFront(obj); fc.renderAll(); }}
              className="px-2 py-1 rounded text-xs transition-colors" style={{ background: "var(--badge-bg)", color: "var(--text-secondary)" }}
              title="Bring to front"
            >↑ Front</button>
            <button
              onClick={() => { const fc = fabricRef.current; if (!fc) return; const obj = fc.getActiveObject(); if (obj) fc.sendObjectToBack(obj); fc.renderAll(); }}
              className="px-2 py-1 rounded text-xs transition-colors" style={{ background: "var(--badge-bg)", color: "var(--text-secondary)" }}
              title="Send to back"
            >↓ Back</button>
            <button onClick={deleteSelected}
              className="px-2 py-1 rounded text-xs transition-colors" style={{ background: "rgba(234,67,53,0.15)", color: "#ea4335" }}>
              Delete
            </button>
          </>
        )}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-2 py-1 rounded text-xs transition-colors"
          style={{ background: "var(--badge-bg)", color: "var(--text-secondary)" }}
          title="Import an image onto the whiteboard"
        >
          + Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importImage(file);
            e.target.value = "";
          }}
        />
        <button onClick={clearBoard}
          className="px-2 py-1 rounded text-xs transition-colors" style={{ background: "var(--badge-bg)", color: "var(--text-tertiary)" }}>
          Clear All
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden" style={{ background: "var(--canvas-bg)" }}>
        <canvas ref={canvasElRef} className="absolute inset-0" />

        {/* Remote cursor overlay — positioned in world coords, transformed by viewport */}
        <div
          ref={cursorContainerRef}
          className="absolute top-0 left-0 pointer-events-none"
          style={{ transformOrigin: "0 0", width: VIRTUAL_W, height: VIRTUAL_H }}
        >
          {Object.entries(remoteCursors).map(([id, { x, y }]) => {
            const color = cursorColor(id);
            return (
              <div
                key={id}
                className="absolute"
                style={{ left: x, top: y, transition: "left 0.05s linear, top 0.05s linear" }}
              >
                <svg width="18" height="22" viewBox="0 0 18 22" fill="none" className="drop-shadow-lg" style={{ marginLeft: -2, marginTop: -2 }}>
                  <path d="M1 1L1 18L5.5 13.5L10 21L13 19.5L8.5 12L15 11L1 1Z" fill={color} stroke="#000" strokeWidth="1.2" />
                </svg>
                <div
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap mt-0.5 ml-3"
                  style={{ backgroundColor: color, color: "#000" }}
                >
                  {id.slice(0, 6)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Minimap */}
        <div className="absolute bottom-6 right-6 z-20 rounded-lg overflow-hidden shadow-xl backdrop-blur-sm" style={{ background: "var(--minimap-bg)", border: "1px solid var(--border)" }}>
          <canvas
            ref={minimapRef}
            width={192}
            height={128}
            className="block"
            title="Minimap — blue rect is your current view"
          />
          <div className="absolute bottom-1 left-2 text-[9px] font-mono pointer-events-none select-none" style={{ color: "var(--text-tertiary)" }}>
            5000 × 5000
          </div>
        </div>

        <div className="absolute right-4 text-[10px] font-mono pointer-events-none" style={{ color: "var(--text-tertiary)", bottom: "calc(128px + 2rem)" }}>
          v{wbVersion} · {shapeCount} obj
        </div>
      </div>
    </div>
  );
}
