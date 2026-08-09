"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

type Props = {
  /** A remote track bundle. Ignored when `videoRef` is given. */
  stream?: MediaStream | null;
  /**
   * For the local tile only. The room page owns one `<video>` ref and re-binds
   * the camera to it as the layout moves the element between slots, so the
   * element has to be driven from outside rather than from a stream prop.
   */
  videoRef?: RefObject<HTMLVideoElement | null>;
  label: string;
  /** Always true for your own tile — otherwise you hear yourself. */
  muted?: boolean;
  handRaised?: boolean;
  /** Green outline marking "this one is you". */
  isSelf?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * One participant's video, with its name badge and raised-hand marker.
 *
 * Used by every layout: the equal-size grid, the picture-in-picture inset, the
 * whiteboard sidebar, and the filmstrip beside a presentation.
 */
export default function VideoTile({
  stream,
  videoRef,
  label,
  muted = false,
  handRaised = false,
  isSelf = false,
  className = "",
  style,
}: Props) {
  const ownRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? ownRef;

  useEffect(() => {
    if (videoRef || !ownRef.current) return;
    ownRef.current.srcObject = stream ?? null;
  }, [stream, videoRef]);

  return (
    <div
      className={`relative bg-black rounded-xl overflow-hidden ${className}`}
      style={{
        border: isSelf ? "2px solid rgba(16, 185, 129, 0.5)" : "1px solid var(--border)",
        ...style,
      }}
    >
      <span className="absolute top-2 left-2 bg-black/60 text-white px-2 py-1 rounded text-xs z-10">
        {label}
      </span>
      {handRaised && <div className="hand-raised-badge">✋</div>}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className="absolute inset-0 w-full h-full object-cover"
      />
    </div>
  );
}
