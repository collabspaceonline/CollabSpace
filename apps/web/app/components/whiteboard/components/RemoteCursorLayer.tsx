"use client";

import React from "react";
import { VIRTUAL_H, VIRTUAL_W } from "../constants";
import { cursorColor } from "../lib/color";
import type { RemoteCursors } from "../hooks/useRemoteCursors";

/**
 * Other people's cursors. Laid out in world coordinates inside a container the
 * canvas keeps under the same transform as the Fabric viewport, so no
 * per-cursor maths is needed here.
 */
export default function RemoteCursorLayer({
  cursors,
  containerRef,
}: {
  cursors: RemoteCursors;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={containerRef}
      className="absolute top-0 left-0 pointer-events-none"
      style={{ transformOrigin: "0 0", width: VIRTUAL_W, height: VIRTUAL_H }}
    >
      {Object.entries(cursors).map(([id, { x, y }]) => {
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
  );
}
