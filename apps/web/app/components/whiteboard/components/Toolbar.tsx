"use client";

import React, { useRef } from "react";
import type { ToolType } from "../types";

/** Tool palette. Adding a tool = one entry here + a branch in the pointer pipeline. */
const TOOLS: { id: ToolType; icon: React.ReactNode; label: string }[] = [
  { id: "select", icon: "↖", label: "Select / Move" },
  { id: "text",   icon: "T", label: "Text" },
  { id: "rect",   icon: "▭", label: "Rectangle" },
  { id: "circle", icon: "◯", label: "Circle / Ellipse" },
  { id: "line",   icon: "╱", label: "Line" },
  { id: "pen",    icon: "✏", label: "Freehand Pen" },
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

const actionBtn = "px-2 py-1 rounded text-xs transition-colors";

export interface ToolbarProps {
  tool: ToolType;
  onToolChange(tool: ToolType): void;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  onFillColor(value: string): void;
  onStrokeColor(value: string): void;
  onStrokeWidth(value: number): void;
  onOpacity(value: number): void;
  hasSelection: boolean;
  onNudgeOpacity(delta: number): void;
  onBringToFront(): void;
  onSendToBack(): void;
  onDeleteSelected(): void;
  onImportImage(file: File): void;
  onClearBoard(): void;
}

export default function Toolbar(props: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2 px-4 py-2 flex-wrap" style={{ background: "var(--toolbar-bg)", borderBottom: "1px solid var(--border)" }}>
      {/* Tools */}
      <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--badge-bg)" }}>
        {TOOLS.map(t => (
          <button
            key={t.id}
            onClick={() => props.onToolChange(t.id)}
            title={t.label}
            className="w-8 h-8 rounded-md text-sm font-bold transition-all flex items-center justify-center"
            style={props.tool === t.id
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
        <input type="color" value={props.fillColor} onChange={e => props.onFillColor(e.target.value)}
          className="w-7 h-7 rounded cursor-pointer bg-transparent border" style={{ borderColor: "var(--border)" }} />
      </label>

      {/* Stroke color */}
      <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
        Stroke
        <input type="color" value={props.strokeColor} onChange={e => props.onStrokeColor(e.target.value)}
          className="w-7 h-7 rounded cursor-pointer bg-transparent border" style={{ borderColor: "var(--border)" }} />
      </label>

      {/* Stroke width */}
      <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
        Width
        <input type="range" min="1" max="12" value={props.strokeWidth}
          onChange={e => props.onStrokeWidth(Number(e.target.value))}
          className="w-20 accent-indigo-400" />
        <span className="w-3" style={{ color: "var(--text-tertiary)" }}>{props.strokeWidth}</span>
      </label>

      {/* Opacity */}
      <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
        Opacity
        <input type="range" min="0.1" max="1" step="0.05" value={props.opacity}
          onChange={e => props.onOpacity(Number(e.target.value))}
          className="w-16 accent-indigo-400" />
      </label>

      <div className="flex-1" />

      {/* Selection-only actions */}
      {props.hasSelection && (
        <>
          <button onClick={() => props.onNudgeOpacity(-0.1)} className={actionBtn}
            style={{ background: "var(--badge-bg)", color: "var(--text-secondary)" }}
            title="Decrease opacity">−α</button>
          <button onClick={() => props.onNudgeOpacity(0.1)} className={actionBtn}
            style={{ background: "var(--badge-bg)", color: "var(--text-secondary)" }}
            title="Increase opacity">+α</button>
          <button onClick={props.onBringToFront} className={actionBtn}
            style={{ background: "var(--badge-bg)", color: "var(--text-secondary)" }}
            title="Bring to front">↑ Front</button>
          <button onClick={props.onSendToBack} className={actionBtn}
            style={{ background: "var(--badge-bg)", color: "var(--text-secondary)" }}
            title="Send to back">↓ Back</button>
          <button onClick={props.onDeleteSelected} className={actionBtn}
            style={{ background: "rgba(234,67,53,0.15)", color: "#ea4335" }}>
            Delete
          </button>
        </>
      )}

      <button
        onClick={() => fileInputRef.current?.click()}
        className={actionBtn}
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
          if (file) props.onImportImage(file);
          e.target.value = "";
        }}
      />
      <button onClick={props.onClearBoard} className={actionBtn}
        style={{ background: "var(--badge-bg)", color: "var(--text-tertiary)" }}>
        Clear All
      </button>
    </div>
  );
}
