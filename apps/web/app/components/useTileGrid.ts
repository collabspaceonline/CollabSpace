"use client";

import { useLayoutEffect, useState } from "react";

/** Video tiles are 16:9. Anything else reads as a stretched or squashed feed. */
export const TILE_ASPECT = 16 / 9;

export type TileGrid = {
  cols: number;
  rows: number;
  /** Pixel size of one tile. Zero until the container has been measured. */
  width: number;
  height: number;
};

/**
 * Fits `count` tiles of a fixed aspect into a box, as large as they can be
 * while all of them still fit — the layout Meet and Zoom use.
 *
 * The alternative, stretching tiles to fill equal grid cells, only looks right
 * when the container happens to be the same shape as the tiles. In a tall,
 * narrow column it turns every tile into a long vertical strip, which is the
 * bug this exists to prevent.
 *
 * Every column count is tried because the best one is not obvious: more
 * columns means narrower cells but fewer rows, and which wins depends entirely
 * on the container's shape.
 */
export function fitTiles(
  boxWidth: number,
  boxHeight: number,
  count: number,
  gap: number,
  aspect: number = TILE_ASPECT,
): TileGrid {
  const best: TileGrid = { cols: 1, rows: Math.max(1, count), width: 0, height: 0 };
  if (count < 1 || boxWidth <= 0 || boxHeight <= 0) return best;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellWidth = (boxWidth - gap * (cols - 1)) / cols;
    const cellHeight = (boxHeight - gap * (rows - 1)) / rows;
    if (cellWidth <= 0 || cellHeight <= 0) continue;

    // The largest 16:9 box that fits this cell — width-bound or height-bound.
    const width = Math.min(cellWidth, cellHeight * aspect);
    if (width > best.width) {
      best.cols = cols;
      best.rows = rows;
      best.width = width;
      best.height = width / aspect;
    }
  }

  return best;
}

/**
 * `fitTiles` against a live-measured element.
 *
 * Attach `ref` to the box the tiles must fit inside; that box has to get its
 * size from its parent (a flex child, say) rather than from the tiles, or the
 * observer and the layout would chase each other.
 */
export function useTileGrid(count: number, gap: number) {
  // A callback ref, not useRef: the measured box comes and goes with the panel
  // it lives in (open the board, close it, last peer leaves). An effect keyed on
  // a ref object would only ever see the element present at mount, and would
  // leave the tiles at their unmeasured zero size forever after.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // Layout effect, not effect: measure before paint so the tiles are never
  // painted at zero size first.
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => setBox({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref: setNode, grid: fitTiles(box.width, box.height, count, gap) };
}
