"use client";

import React from "react";
import { MINIMAP_H, MINIMAP_W, VIRTUAL_H, VIRTUAL_W } from "../constants";

/** The minimap shell — it is painted by `canvas/features/minimap.ts`. */
export default function Minimap({
  canvasRef,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  return (
    <div className="absolute bottom-6 right-6 z-20 rounded-lg overflow-hidden shadow-xl backdrop-blur-sm" style={{ background: "var(--minimap-bg)", border: "1px solid var(--border)" }}>
      <canvas
        ref={canvasRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        className="block"
        title="Minimap — blue rect is your current view"
      />
      <div className="absolute bottom-1 left-2 text-[9px] font-mono pointer-events-none select-none" style={{ color: "var(--text-tertiary)" }}>
        {VIRTUAL_W} × {VIRTUAL_H}
      </div>
    </div>
  );
}
