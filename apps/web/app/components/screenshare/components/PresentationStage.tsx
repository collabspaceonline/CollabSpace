"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SURFACE_LABELS } from "../constants";
import type { ShareSurface } from "../types";

export type StagePresenter = {
  socketId: string;
  label: string;
};

type Props = {
  /** Whose presentation fills the stage. */
  presenterLabel: string;
  surface: ShareSurface;
  /** Null while the presentation is announced but its track has not arrived. */
  stream: MediaStream | null;
  isLocal: boolean;
  onStopPresenting: () => void;
  /** The other live presentations, when more than one person is sharing. */
  others: StagePresenter[];
  onSelectPresenter: (socketId: string) => void;
};

/**
 * The shared screen itself.
 *
 * The one rule that matters here is `object-fit: contain`. A participant tile
 * crops to fill because a cropped face is still a face; cropping a shared
 * screen cuts off the toolbar someone is pointing at.
 */
export default function PresentationStage({
  presenterLabel,
  surface,
  stream,
  isLocal,
  onStopPresenting,
  others,
  onSelectPresenter,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // Fullscreen can also be left with Escape or the browser's own chrome, so the
  // button's state comes from the event, never from our own click.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  return (
    <div ref={stageRef} className="presentation-stage">
      <div className="presentation-topbar">
        <span className="presentation-badge">
          <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
            present_to_all
          </span>
          {isLocal ? "You are presenting" : `${presenterLabel} is presenting`}
          <span className="presentation-surface">{SURFACE_LABELS[surface]}</span>
        </span>

        <div className="presentation-actions">
          {isLocal && (
            <button className="presentation-action presentation-action--stop" onClick={onStopPresenting}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                cancel_presentation
              </span>
              Stop presenting
            </button>
          )}
          <button
            className="presentation-action"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit full screen" : "Full screen"}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
              {isFullscreen ? "fullscreen_exit" : "fullscreen"}
            </span>
          </button>
        </div>
      </div>

      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // Muted for our own capture only: hearing your own shared tab audio
          // back is an echo. A remote presentation must stay audible.
          muted={isLocal}
          className="presentation-video"
        />
      ) : (
        <div className="presentation-placeholder">
          <span className="material-symbols-rounded" style={{ fontSize: 40 }}>
            present_to_all
          </span>
          <p>Waiting for {isLocal ? "your" : `${presenterLabel}'s`} screen…</p>
        </div>
      )}

      {others.length > 0 && (
        <div className="presentation-switcher">
          <span className="presentation-switcher-label">Also presenting</span>
          {others.map((other) => (
            <button key={other.socketId} onClick={() => onSelectPresenter(other.socketId)}>
              {other.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
