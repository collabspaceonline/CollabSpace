import { useMemo } from "react";
import type { Socket } from "socket.io-client";
import { fabricObjToShape } from "../lib/shape";
import type { FabricObj, Shape } from "../types";

/**
 * Every outgoing whiteboard message goes through here — one place to see the
 * client half of the wire protocol (the server half is in
 * `apps/sfu-server/src/socket/handlers/whiteboard.js`).
 */
export interface WhiteboardEmitters {
  createShape(obj: FabricObj): void;
  /** Live update while dragging — no clientVersion, so the server skips the version gate. */
  liveUpdate(obj: FabricObj): void;
  /** Committed update — version-gated so stale writes lose. */
  commitUpdate(obj: FabricObj, changes?: Partial<Shape>): void;
  deleteShape(id: string): void;
  clearBoard(): void;
  lockShape(id: string): void;
  unlockShape(id: string): void;
  cursorMove(x: number, y: number): void;
  cursorLeave(): void;
}

export function createEmitters(socket: Socket): WhiteboardEmitters {
  return {
    createShape(obj) {
      if (!socket) return;
      socket.emit("wb:createShape", { shape: fabricObjToShape(obj) });
    },
    liveUpdate(obj) {
      if (!socket || !obj?.shapeId) return;
      socket.emit("wb:updateShape", { id: obj.shapeId, changes: fabricObjToShape(obj) });
    },
    commitUpdate(obj, changes) {
      if (!socket || !obj?.shapeId) return;
      socket.emit("wb:updateShape", {
        id: obj.shapeId,
        changes: changes ?? fabricObjToShape(obj),
        clientVersion: obj.__version ?? 0,
      });
    },
    deleteShape(id) {
      socket?.emit("wb:deleteShape", { id });
    },
    clearBoard() {
      socket?.emit("wb:clearBoard");
    },
    lockShape(id) {
      socket?.emit("wb:lockShape", { id, userId: socket?.id });
    },
    unlockShape(id) {
      socket?.emit("wb:unlockShape", { id });
    },
    cursorMove(x, y) {
      socket?.emit("wb:cursorMove", { x, y });
    },
    cursorLeave() {
      socket?.emit("wb:cursorLeave");
    },
  };
}

export function useWhiteboardEmitters(socket: Socket): WhiteboardEmitters {
  return useMemo(() => createEmitters(socket), [socket]);
}
