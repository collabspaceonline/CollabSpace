import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAPTURE_UNSUPPORTED,
  NO_TRANSPORT_ERROR,
  SCREEN_CODEC_OPTIONS,
  SCREEN_ENCODINGS,
} from "../constants";
import {
  captureDisplaySurface,
  describeCaptureError,
  isCaptureCancelled,
  isDisplayCaptureSupported,
  onCaptureEnded,
  stopStream,
} from "../lib/displayMedia";
import { useScreenShareEmitters } from "../net/emitters";
import type { ScreenShareController, ShareSurface, UseScreenShareOptions } from "../types";

/**
 * The presenter's half of screen sharing: capture the surface, produce it to
 * the SFU as a second video track, and unwind all of that on stop.
 *
 * A share ends three different ways and all of them land in `stop()`:
 * our own button, the browser's floating "Stop sharing" bar (the track's
 * `ended` event), and leaving the call (unmount).
 */
export function useScreenShare({
  socket,
  getSendTransport,
}: UseScreenShareOptions): ScreenShareController {
  const emitters = useScreenShareEmitters(socket);

  const [isSharing, setIsSharing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [surface, setSurface] = useState<ShareSurface | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Producers and the capture live in refs, not state: `stop()` must be able to
  // reach the current ones from a track event listener that was attached once.
  const producersRef = useRef<{ video: any; audio: any }>({ video: null, audio: null });
  const streamRef = useRef<MediaStream | null>(null);
  const unbindEndedRef = useRef<(() => void) | null>(null);
  // Guards the async gap while the browser picker is open, so a double click
  // cannot start two captures.
  const busyRef = useRef(false);

  const stop = useCallback(async () => {
    unbindEndedRef.current?.();
    unbindEndedRef.current = null;

    const { video, audio } = producersRef.current;
    producersRef.current = { video: null, audio: null };
    for (const producer of [video, audio]) {
      if (!producer || producer.closed) continue;
      // Tell the SFU first: after `close()` the producer still knows its id,
      // but we would rather not depend on that ordering being safe.
      emitters.closeProducer(producer.id);
      producer.close();
    }

    stopStream(streamRef.current);
    streamRef.current = null;

    emitters.stop();
    setStream(null);
    setSurface(null);
    setIsSharing(false);
  }, [emitters]);

  // `stop` is rebuilt whenever the socket changes; the track listener captures
  // this ref instead so it always calls the current one.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = useCallback(
    async (requested: ShareSurface) => {
      if (busyRef.current || streamRef.current) return;
      if (!isDisplayCaptureSupported()) {
        setError(CAPTURE_UNSUPPORTED);
        return;
      }
      const transport = getSendTransport();
      if (!transport) {
        setError(NO_TRANSPORT_ERROR);
        return;
      }

      busyRef.current = true;
      setIsStarting(true);
      setError(null);

      let captured: MediaStream | null = null;
      try {
        captured = await captureDisplaySurface(requested);
        const [videoTrack] = captured.getVideoTracks();
        if (!videoTrack) throw new Error("No video track in the capture");

        producersRef.current.video = await transport.produce({
          track: videoTrack,
          encodings: SCREEN_ENCODINGS,
          codecOptions: SCREEN_CODEC_OPTIONS,
          appData: { source: "screen" },
        });

        // Tab and full-screen captures can carry audio; a window capture never
        // does, and the user may untick the box on the ones that can.
        const [audioTrack] = captured.getAudioTracks();
        if (audioTrack) {
          producersRef.current.audio = await transport.produce({
            track: audioTrack,
            appData: { source: "screenAudio" },
          });
        }

        // Chrome's own "Stop sharing" bar only ends the track — this is what
        // turns that into a full teardown.
        unbindEndedRef.current = onCaptureEnded(captured, () => {
          void stopRef.current();
        });

        streamRef.current = captured;
        setStream(captured);
        setSurface(requested);
        setIsSharing(true);
        emitters.start(requested);
      } catch (err) {
        // Nothing was announced yet, so just drop whatever we grabbed.
        stopStream(captured);
        if (!isCaptureCancelled(err)) {
          console.error("Screen share failed:", err);
          setError(describeCaptureError(err));
        }
      } finally {
        busyRef.current = false;
        setIsStarting(false);
      }
    },
    [emitters, getSendTransport],
  );

  // Leaving the room must not leave the browser's sharing bar up.
  useEffect(() => {
    return () => {
      unbindEndedRef.current?.();
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return { isSharing, isStarting, surface, stream, error, start, stop, dismissError };
}
