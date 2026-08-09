"use client";

import { useCallback, useState } from "react";
import type { ScreenShareController, ShareSurface } from "../types";
import ShareSourcePicker from "./ShareSourcePicker";

type Props = {
  screenShare: ScreenShareController;
  /** False before the peer is producing — you cannot present without a call. */
  disabled?: boolean;
};

/**
 * The control-bar entry point. One button that opens the source picker, then
 * becomes "Stop presenting" for as long as the share is live.
 */
export default function ScreenShareButton({ screenShare, disabled = false }: Props) {
  const { isSharing, isStarting, error, start, stop, dismissError } = screenShare;
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleSelect = useCallback(
    (surface: ShareSurface) => {
      setPickerOpen(false);
      void start(surface);
    },
    [start],
  );

  const handleClick = useCallback(() => {
    if (isSharing) {
      void stop();
      return;
    }
    dismissError();
    setPickerOpen(true);
  }, [isSharing, stop, dismissError]);

  return (
    <>
      <button
        onClick={handleClick}
        disabled={disabled || isStarting}
        className={`meet-btn ${isSharing ? "active-on" : ""}`}
        title={isSharing ? "Stop presenting" : "Present now"}
        aria-pressed={isSharing}
        style={disabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
      >
        <span className="material-symbols-rounded" style={{ fontSize: 24 }}>
          {isSharing ? "cancel_presentation" : "present_to_all"}
        </span>
      </button>

      <ShareSourcePicker
        open={pickerOpen}
        onSelect={handleSelect}
        onClose={() => setPickerOpen(false)}
      />

      {error && (
        <div className="share-error" role="alert">
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
            error
          </span>
          <span>{error}</span>
          <button onClick={dismissError} aria-label="Dismiss">
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
              close
            </span>
          </button>
        </div>
      )}
    </>
  );
}
