import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Socket } from "socket.io-client";
import { findByShapeId } from "../lib/shape";
import {
  addRemoteShape,
  applyRemoteShape,
  lockRemoteShape,
  unlockRemoteShape,
} from "../net/remoteShapes";
import type { FabricObj, Shape } from "../types";
import type { BoardCanvas } from "./useBoardCanvas";

/**
 * Incoming whiteboard state: the initial snapshot plus every `wb:*` broadcast.
 *
 * All of it runs with `suppressEmit` raised so applying remote state can never
 * echo back out as a local change.
 */
export function useBoardSync(params: {
  socket: Socket;
  board: BoardCanvas;
  setShapeCount: Dispatch<SetStateAction<number>>;
  setWbVersion: Dispatch<SetStateAction<number>>;
}): void {
  const { socket, board, setShapeCount, setWbVersion } = params;
  const { fabricRef, drawing, suppressEmit } = board;

  // ── Initial snapshot when the board opens ────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    socket.emit("wb:getState", ({ shapes, version }: { shapes: Shape[]; version: number }) => {
      setWbVersion(version);
      // The canvas itself mounts on a timer; wait for it before loading.
      setTimeout(() => {
        const fc = fabricRef.current;
        if (!fc || !shapes.length) return;
        suppressEmit.current = true;
        fc.loadFromJSON(
          { version: "5.3.0", objects: shapes.map((s) => ({ ...s, shapeId: s.id })) },
          () => {
            fc.getObjects().forEach((obj: FabricObj, i: number) => {
              obj.shapeId = shapes[i]?.id;
            });
            fc.renderAll();
            setShapeCount(fc.getObjects().length);
            suppressEmit.current = false;
          },
        );
      }, 50);
    });
  }, [socket, fabricRef, suppressEmit, setShapeCount, setWbVersion]);

  // ── Live broadcasts from other clients ───────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onShapeCreated = async ({ shape }: { shape: Shape }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      if (findByShapeId(fc, shape.id)) return;
      suppressEmit.current = true;
      await addRemoteShape(fc, shape);
      setShapeCount(fc.getObjects().length);
      suppressEmit.current = false;
    };

    const onShapeUpdated = ({ shape }: { shape: Shape }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      const obj = findByShapeId(fc, shape.id);
      if (!obj) return;

      // Never overwrite what the local user is in the middle of doing — just
      // record the server version so the eventual commit is not rejected.
      const isActivelyDrawing =
        drawing.activeShape.current?.shapeId === shape.id ||
        drawing.line.current?.shapeId === shape.id;
      const isActivelyTyping = obj.isEditing === true;

      if (isActivelyDrawing || isActivelyTyping) {
        obj.__version = shape.version ?? 0;
        return;
      }

      suppressEmit.current = true;
      applyRemoteShape(fc, obj, shape);
      suppressEmit.current = false;
    };

    const onShapeDeleted = ({ id }: { id: string }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      const obj = findByShapeId(fc, id);
      if (!obj) return;
      fc.remove(obj);
      fc.renderAll();
      setShapeCount(fc.getObjects().length);
    };

    const onShapeLocked = ({ id }: { id: string; userId: string }) => {
      const fc = fabricRef.current;
      const obj = findByShapeId(fc, id);
      if (!fc || !obj) return;
      suppressEmit.current = true;
      lockRemoteShape(fc, obj);
      suppressEmit.current = false;
    };

    const onShapeUnlocked = ({ id }: { id: string }) => {
      const fc = fabricRef.current;
      const obj = findByShapeId(fc, id);
      if (!fc || !obj) return;
      suppressEmit.current = true;
      unlockRemoteShape(fc, obj);
      suppressEmit.current = false;
    };

    const onBoardCleared = () => {
      const fc = fabricRef.current;
      if (!fc) return;
      suppressEmit.current = true;
      fc.clear();
      fc.renderAll();
      setShapeCount(0);
      suppressEmit.current = false;
    };

    // The server rejected our update — take its version as the truth.
    const onShapeConflict = ({ shape }: { shape: Shape }) => {
      const fc = fabricRef.current;
      if (!fc) return;
      const obj = findByShapeId(fc, shape.id);
      if (!obj) return;
      suppressEmit.current = true;
      applyRemoteShape(fc, obj, shape);
      suppressEmit.current = false;
    };

    const handlers: Record<string, (...args: any[]) => void> = {
      "wb:shapeCreated": onShapeCreated,
      "wb:shapeUpdated": onShapeUpdated,
      "wb:shapeDeleted": onShapeDeleted,
      "wb:shapeLocked": onShapeLocked,
      "wb:shapeUnlocked": onShapeUnlocked,
      "wb:boardCleared": onBoardCleared,
      "wb:shapeConflict": onShapeConflict,
    };

    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    // Detach by reference — other components listen to some of these events too.
    return () => {
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
    };
  }, [socket, fabricRef, drawing, suppressEmit, setShapeCount]);
}
