"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { updateBrush } from "./canvas/toolMode";
import Minimap from "./components/Minimap";
import RemoteCursorLayer from "./components/RemoteCursorLayer";
import Toolbar from "./components/Toolbar";
import { INITIAL_STYLE, TOOL_DEFAULTS } from "./constants";
import { useBoardCanvas } from "./hooks/useBoardCanvas";
import { useBoardSync } from "./hooks/useBoardSync";
import { useRemoteCursors } from "./hooks/useRemoteCursors";
import * as actions from "./lib/boardActions";
import { useWhiteboardEmitters } from "./net/emitters";
import type { BoardCallbacks, FabricCanvasLike, FabricObj, ToolType, WhiteboardProps } from "./types";

/**
 * Composition root for the whiteboard.
 *
 * This file owns React state and layout only. Canvas behaviour lives in
 * `canvas/`, the wire protocol in `net/`, and the lifecycle glue in `hooks/`.
 * See ARCHITECTURE.md before adding anything here.
 */
export default function Whiteboard({ socket }: WhiteboardProps) {
  const [tool, setTool] = useState<ToolType>("select");
  const [fillColor, setFillColor] = useState(INITIAL_STYLE.fill);
  const [strokeColor, setStrokeColor] = useState(INITIAL_STYLE.stroke);
  const [strokeWidth, setStrokeWidth] = useState(INITIAL_STYLE.strokeWidth);
  const [opacity, setOpacity] = useState(INITIAL_STYLE.opacity);
  const [wbVersion, setWbVersion] = useState(0);
  const [shapeCount, setShapeCount] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);

  const emit = useWhiteboardEmitters(socket);

  /** Load a newly selected object's style into the toolbar inputs. */
  const syncStyleFromObject = useCallback((obj: FabricObj) => {
    if (!obj) return;
    if (obj.type === "rect" || obj.type === "ellipse") {
      if (obj.fill && typeof obj.fill === "string") setFillColor(obj.fill);
      if (obj.stroke && typeof obj.stroke === "string") setStrokeColor(obj.stroke);
    } else {
      // line, path (pen) — primary colour lives in stroke
      if (obj.stroke && typeof obj.stroke === "string") setFillColor(obj.stroke);
    }
    if (obj.strokeWidth != null) setStrokeWidth(obj.strokeWidth);
    if (obj.opacity != null) setOpacity(obj.opacity);
  }, []);

  const callbacks = useMemo<BoardCallbacks>(
    () => ({ setShapeCount, setHasSelection, setTool, syncStyleFromObject }),
    [syncStyleFromObject],
  );

  const board = useBoardCanvas({ socket, emit, callbacks });
  useBoardSync({ socket, board, setShapeCount, setWbVersion });
  const remoteCursors = useRemoteCursors(socket);

  // ─── Mirror React state into the refs the canvas reads ─────────────────────
  useEffect(() => {
    board.style.tool.current = tool;
    const d = TOOL_DEFAULTS[tool];
    if (d) {
      if (d.fill !== undefined) setFillColor(d.fill);
      if (d.stroke !== undefined) setStrokeColor(d.stroke);
      if (d.strokeWidth !== undefined) setStrokeWidth(d.strokeWidth);
    }
    board.applyToolMode();
  }, [tool, board]);
  useEffect(() => { board.style.fill.current = fillColor; }, [fillColor, board]);
  useEffect(() => { board.style.stroke.current = strokeColor; }, [strokeColor, board]);
  useEffect(() => { board.style.strokeWidth.current = strokeWidth; }, [strokeWidth, board]);
  useEffect(() => { board.style.opacity.current = opacity; }, [opacity, board]);

  // Keep the pen brush in step with the colour / width controls
  useEffect(() => {
    const fc = board.fabricRef.current;
    if (fc) updateBrush(fc, fillColor, strokeWidth);
  }, [fillColor, strokeWidth, board]);

  // ─── Toolbar actions ───────────────────────────────────────────────────────
  const withCanvas = useCallback(
    (fn: (fc: FabricCanvasLike) => void) => {
      const fc = board.fabricRef.current;
      if (fc) fn(fc);
    },
    [board],
  );

  const applyToSelection = useCallback(
    (mutate: (obj: FabricObj) => void) => withCanvas((fc) => actions.applyToSelection(fc, emit, mutate)),
    [withCanvas, emit],
  );

  const handleFillColor = (val: string) => {
    setFillColor(val);
    applyToSelection((obj) => {
      if (obj.type === "rect" || obj.type === "ellipse") obj.set({ fill: val });
      else obj.set({ stroke: val });
    });
  };

  const handleStrokeColor = (val: string) => {
    setStrokeColor(val);
    applyToSelection((obj) => {
      if (obj.type === "rect" || obj.type === "ellipse") obj.set({ stroke: val });
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

  const handleDeleteSelected = () =>
    withCanvas((fc) => {
      actions.deleteSelected(fc, emit);
      setShapeCount(fc.getObjects().length);
      setHasSelection(false);
    });

  const handleClearBoard = () => {
    if (!confirm("Clear the whiteboard for everyone?")) return;
    withCanvas((fc) => {
      actions.clearBoard(fc, emit);
      setShapeCount(0);
    });
  };

  const handleImportImage = (file: File) =>
    withCanvas((fc) => actions.importImage(fc, emit, file, () => setShapeCount(fc.getObjects().length)));

  // Local-only view tweaks — deliberately not broadcast.
  const handleNudgeOpacity = (delta: number) =>
    withCanvas((fc) => {
      fc.getActiveObjects().forEach((o: FabricObj) => {
        o.set({ opacity: Math.min(1, Math.max(0.1, (o.opacity ?? 1) + delta)) });
      });
      fc.renderAll();
    });

  const handleBringToFront = () =>
    withCanvas((fc) => {
      const obj = fc.getActiveObject();
      if (obj) fc.bringObjectToFront(obj);
      fc.renderAll();
    });

  const handleSendToBack = () =>
    withCanvas((fc) => {
      const obj = fc.getActiveObject();
      if (obj) fc.sendObjectToBack(obj);
      fc.renderAll();
    });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Toolbar
        tool={tool}
        onToolChange={setTool}
        fillColor={fillColor}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        opacity={opacity}
        onFillColor={handleFillColor}
        onStrokeColor={handleStrokeColor}
        onStrokeWidth={handleStrokeWidth}
        onOpacity={handleOpacity}
        hasSelection={hasSelection}
        onNudgeOpacity={handleNudgeOpacity}
        onBringToFront={handleBringToFront}
        onSendToBack={handleSendToBack}
        onDeleteSelected={handleDeleteSelected}
        onImportImage={handleImportImage}
        onClearBoard={handleClearBoard}
      />

      <div className="flex-1 relative overflow-hidden" style={{ background: "var(--canvas-bg)" }}>
        <canvas ref={board.canvasElRef} className="absolute inset-0" />

        <RemoteCursorLayer cursors={remoteCursors} containerRef={board.cursorLayerRef} />

        <Minimap canvasRef={board.minimapRef} />

        <div className="absolute right-4 text-[10px] font-mono pointer-events-none" style={{ color: "var(--text-tertiary)", bottom: "calc(128px + 2rem)" }}>
          v{wbVersion} · {shapeCount} obj
        </div>
      </div>
    </div>
  );
}
