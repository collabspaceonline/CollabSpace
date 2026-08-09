import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Socket } from "socket.io-client";
import { mountBoardCanvas } from "../canvas/mount";
import { applyToolMode as applyToolModeToCanvas } from "../canvas/toolMode";
import { INITIAL_STYLE } from "../constants";
import type { WhiteboardEmitters } from "../net/emitters";
import type {
  BoardCallbacks,
  BoardElements,
  DrawingRefs,
  FabricCanvasLike,
  FabricObj,
  StyleRefs,
  ToolType,
} from "../types";

export interface BoardCanvas {
  /** Attach to the <canvas> the board draws on. */
  canvasElRef: React.RefObject<HTMLCanvasElement | null>;
  minimapRef: React.RefObject<HTMLCanvasElement | null>;
  cursorLayerRef: React.RefObject<HTMLDivElement | null>;
  fabricRef: React.RefObject<FabricCanvasLike | null>;
  style: StyleRefs;
  drawing: DrawingRefs;
  suppressEmit: React.RefObject<boolean>;
  applyToolMode(): void;
}

/**
 * Owns the Fabric canvas lifecycle and the mutable refs the canvas features
 * read on every pointer event. React state never reaches the canvas directly —
 * the component mirrors it into `style` refs, which is what keeps the listeners
 * stable for the whole session.
 */
export function useBoardCanvas(params: {
  socket: Socket;
  emit: WhiteboardEmitters;
  callbacks: BoardCallbacks;
}): BoardCanvas {
  const { socket, emit, callbacks } = params;

  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const cursorLayerRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvasLike | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const suppressEmit = useRef(false);

  const toolRef = useRef<ToolType>("select");
  const fillRef = useRef(INITIAL_STYLE.fill);
  const strokeRef = useRef(INITIAL_STYLE.stroke);
  const strokeWidthRef = useRef(INITIAL_STYLE.strokeWidth);
  const opacityRef = useRef(INITIAL_STYLE.opacity);

  const isDrawingShapeRef = useRef(false);
  const isErasingRef = useRef(false);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const activeShapeRef = useRef<FabricObj | null>(null);
  const lineRef = useRef<FabricObj | null>(null);
  const liveThrottleRef = useRef(0);
  const cursorThrottleRef = useRef(0);

  const style = useMemo<StyleRefs>(
    () => ({
      tool: toolRef,
      fill: fillRef,
      stroke: strokeRef,
      strokeWidth: strokeWidthRef,
      opacity: opacityRef,
    }),
    [],
  );

  const drawing = useMemo<DrawingRefs>(
    () => ({
      isDrawingShape: isDrawingShapeRef,
      isErasing: isErasingRef,
      origin: originRef,
      activeShape: activeShapeRef,
      line: lineRef,
      liveThrottle: liveThrottleRef,
      cursorThrottle: cursorThrottleRef,
    }),
    [],
  );

  const elements = useMemo<BoardElements>(
    () => ({ minimap: minimapRef, cursorLayer: cursorLayerRef }),
    [],
  );

  // Canvas listeners live for the whole session, so they call through a proxy
  // that always reads the latest render's callbacks.
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });
  const callbackProxy = useMemo<BoardCallbacks>(
    () => ({
      setShapeCount: (n) => callbacksRef.current.setShapeCount(n),
      setHasSelection: (v) => callbacksRef.current.setHasSelection(v),
      setTool: (t) => callbacksRef.current.setTool(t),
      syncStyleFromObject: (obj) => callbacksRef.current.syncStyleFromObject(obj),
    }),
    [],
  );

  // Deferred a tick so the parent layout has settled and the canvas element
  // reports its real size.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (fabricRef.current || !canvasElRef.current) return;
      const mounted = mountBoardCanvas({
        canvasEl: canvasElRef.current,
        socket,
        emit,
        elements,
        style,
        drawing,
        suppressEmit,
        callbacks: callbackProxy,
      });
      fabricRef.current = mounted.canvas;
      disposeRef.current = mounted.dispose;
    }, 0);

    return () => {
      clearTimeout(timer);
      disposeRef.current?.();
      disposeRef.current = null;
      fabricRef.current = null;
    };
  }, [socket, emit, elements, style, drawing, callbackProxy]);

  const applyToolMode = useCallback(() => {
    const fc = fabricRef.current;
    if (fc) applyToolModeToCanvas(fc, style);
  }, [style]);

  // Stable identity — the component uses this object in effect dependencies.
  return useMemo(
    () => ({
      canvasElRef,
      minimapRef,
      cursorLayerRef,
      fabricRef,
      style,
      drawing,
      suppressEmit,
      applyToolMode,
    }),
    [style, drawing, applyToolMode],
  );
}
