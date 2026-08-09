"use client";

import { useEffect, useRef } from "react";
import { SHARE_SURFACE_OPTIONS } from "../constants";
import type { ShareSurface } from "../types";

type Props = {
  open: boolean;
  onSelect: (surface: ShareSurface) => void;
  onClose: () => void;
};

/**
 * "Present now" — choose a tab, a window, or the whole screen.
 *
 * A browser will never let a page enumerate the user's tabs and windows, so
 * this cannot be the real source list. What it does is pick which pane of the
 * browser's own picker opens next, via `displaySurface`. That is the same two
 * step flow Google Meet uses, and the reason the wording matches theirs.
 */
export default function ShareSourcePicker({ open, onSelect, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes, and focus moves into the dialog so the arrow keys and Tab
  // stay inside it rather than wandering into the call controls behind.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.querySelector<HTMLButtonElement>(".share-option")?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="share-picker-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="share-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-picker-title"
      >
        <div className="share-picker-header">
          <h2 id="share-picker-title">Share your screen</h2>
          <button className="share-picker-close" onClick={onClose} aria-label="Close">
            <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
              close
            </span>
          </button>
        </div>

        <div className="share-picker-options">
          {SHARE_SURFACE_OPTIONS.map((option) => (
            <button
              key={option.id}
              className="share-option"
              onClick={() => onSelect(option.id)}
            >
              <SurfaceArt surface={option.id} />
              <span className="share-option-label">
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                  {option.icon}
                </span>
                {option.label}
              </span>
              <span className="share-option-description">{option.description}</span>
            </button>
          ))}
        </div>

        <p className="share-picker-note">
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
            info
          </span>
          Your browser will ask you to pick the exact source next.
        </p>
      </div>
    </div>
  );
}

/**
 * A small abstract mock of what each option shares. Drawn inline rather than
 * shipped as images so it inherits the theme's colours in both light and dark.
 */
function SurfaceArt({ surface }: { surface: ShareSurface }) {
  return (
    <svg className="share-option-art" viewBox="0 0 120 76" aria-hidden focusable="false">
      {/* The desktop behind everything — dimmed unless it is what you share. */}
      <rect
        x="4"
        y="6"
        width="112"
        height="64"
        rx="6"
        className={surface === "monitor" ? "art-surface art-active" : "art-surface"}
      />

      {surface === "browser" && (
        <>
          {/* A browser frame with three tabs, the middle one highlighted. */}
          <rect x="16" y="16" width="88" height="46" rx="4" className="art-window" />
          <rect x="20" y="19" width="22" height="8" rx="2" className="art-tab" />
          <rect x="45" y="19" width="22" height="8" rx="2" className="art-tab art-active" />
          <rect x="70" y="19" width="22" height="8" rx="2" className="art-tab" />
          <rect x="20" y="32" width="80" height="26" rx="3" className="art-content art-active" />
        </>
      )}

      {surface === "window" && (
        <>
          {/* Two overlapping app windows; the front one is what gets shared. */}
          <rect x="12" y="14" width="62" height="40" rx="4" className="art-window" />
          <rect x="40" y="26" width="66" height="38" rx="4" className="art-window art-active" />
          <rect x="46" y="32" width="54" height="4" rx="2" className="art-content art-active" />
          <rect x="46" y="41" width="38" height="4" rx="2" className="art-content art-active" />
        </>
      )}

      {surface === "monitor" && (
        <>
          {/* The whole desktop: a couple of windows plus the taskbar. */}
          <rect x="14" y="16" width="44" height="30" rx="3" className="art-content art-active" />
          <rect x="64" y="16" width="38" height="20" rx="3" className="art-content art-active" />
          <rect x="14" y="52" width="88" height="10" rx="3" className="art-content art-active" />
        </>
      )}
    </svg>
  );
}
