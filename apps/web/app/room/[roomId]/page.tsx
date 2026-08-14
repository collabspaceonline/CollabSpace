"use client";

import { useEffect, useState, useRef, useCallback, useMemo, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import Whiteboard from "../../components/whiteboard";
import ReactionOverlay, { Reaction } from "../../components/ReactionOverlay";
import VideoTile from "../../components/VideoTile";
import { useTileGrid } from "../../components/useTileGrid";
import {
  PresentationStage,
  ScreenShareButton,
  isScreenSource,
  isScreenVideoSource,
  normalizeSource,
  useRemotePresentations,
  useScreenShare,
  type MediaSource,
} from "../../components/screenshare";

// ─── Mediasoup globals ────────────────────────────────────────────────────────
let socket: Socket;
let device: any;
let sendTransport: any;
let recvTransport: any;
let localStream: MediaStream | null;
let audioProducer: any;
let videoProducer: any;

/** The part of a mediasoup Consumer this page actually touches. */
type TrackConsumer = { kind: "audio" | "video"; track: MediaStreamTrack; close(): void };

/** What the SFU tells us about a producer, in `new-producer` and `getProducers`. */
type ProducerInfo = { producerId: string; socketId: string; source?: MediaSource };

/**
 * producerId -> the consumer we built for it, so `producer-closed` can find the
 * right track to pull out of the right stream. A screen share stopping is an
 * individual producer closing, not a peer leaving.
 */
const consumers = new Map<string, { consumer: TrackConsumer; socketId: string; source: MediaSource }>();

// ─── Material Symbol helper ──────────────────────────────────────────────────
const MIcon = ({ name, className = "" }: { name: string; className?: string }) => (
  <span className={`material-symbols-rounded ${className}`} style={{ fontSize: 24 }}>
    {name}
  </span>
);

// ─── Reactions Emoji List ────────────────────────────────────────────────────
const REACTIONS = ["👍", "❤️", "😂", "🎉", "😮"];

/**
 * A cols/rows split that stays as square as possible. Paired with `1fr` tracks
 * it divides the available box between the tiles: every tile is the same size,
 * and more people means smaller tiles rather than a taller, scrolling list.
 */
function gridFor(count: number) {
  const n = Math.max(1, count);
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/** Gap between participant tiles in the board sidebar, in px (Tailwind gap-2). */
const SIDEBAR_TILE_GAP = 8;

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();

  // ─── Video call state ──────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);
  const [isMediaActive, setIsMediaActive] = useState(false);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<{ socketId: string; stream: MediaStream }[]>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // ─── Screen share state ────────────────────────────────────────────────────
  // Presentations arrive on two channels: the announcement (who is presenting,
  // via useRemotePresentations) and the pixels (a producer tagged `screen`,
  // consumed below into this map). They are joined by socket id.
  const [screenStreams, setScreenStreams] = useState<Record<string, MediaStream>>({});
  const [pinnedPresenterId, setPinnedPresenterId] = useState<string | null>(null);

  // ─── UI state ──────────────────────────────────────────────────────────────
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);
  const [mySocketId, setMySocketId] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [showSettings, setShowSettings] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<Reaction[]>([]);

  const removeReaction = useCallback((id: string) => {
    setReactions(prev => prev.filter(r => r.id !== id));
  }, []);
  const settingsRef = useRef<HTMLDivElement>(null);
  const reactionsRef = useRef<HTMLDivElement>(null);

  // ─── Screen share wiring ───────────────────────────────────────────────────
  // The send transport is a module global created long after mount, so the hook
  // reads it lazily instead of receiving it.
  const getSendTransport = useCallback(() => sendTransport, []);
  const screenShare = useScreenShare({ socket: socketInstance, getSendTransport });
  const presentations = useRemotePresentations(socketInstance);

  const labelFor = useCallback(
    (socketId: string) => (socketId === mySocketId ? "You" : `Peer (${socketId.substring(0, 4)})`),
    [mySocketId],
  );

  // Newest presentation takes the stage, unless the user pinned another one.
  // The pin falls back automatically when that person stops presenting.
  const activePresentation = useMemo(() => {
    if (presentations.length === 0) return null;
    return (
      presentations.find(p => p.socketId === pinnedPresenterId) ??
      presentations[presentations.length - 1] ??
      null
    );
  }, [presentations, pinnedPresenterId]);

  const activeStream = activePresentation
    ? activePresentation.socketId === mySocketId
      ? screenShare.stream
      : screenStreams[activePresentation.socketId] ?? null
    : null;

  const otherPresenters = activePresentation
    ? presentations
        .filter(p => p.socketId !== activePresentation.socketId)
        .map(p => ({ socketId: p.socketId, label: labelFor(p.socketId) }))
    : [];

  // ─── Apply theme to document ───────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // ─── Close dropdowns on outside click ──────────────────────────────────────
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
      if (reactionsRef.current && !reactionsRef.current.contains(e.target as Node)) {
        setShowReactions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Re-attach local stream whenever the video element mounts or remounts.
  // The layout swaps the <video> between full-grid, PiP, sidebar and filmstrip
  // slots as participants join/leave and presentations start, so we re-bind on
  // every layout-affecting change.
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [showWhiteboard, isMediaActive, remoteStreams.length, activePresentation]);

  // ─── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sfuUrl = process.env.NEXT_PUBLIC_SFU_URL || "http://localhost:4000";
    socket = io(sfuUrl, {
      transports: ["websocket"],
      secure: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      setIsConnected(true);
      setMySocketId(socket.id ?? "");
      setSocketInstance(socket);
    });
    socket.on("disconnect", () => setIsConnected(false));
    socket.on("connect_error", (err) => console.error("Socket error:", err.message));

    socket.on("new-producer", ({ producerId, socketId, source }: ProducerInfo) => {
      if (device && recvTransport && socketId !== socket.id) {
        consumeRemoteTrack({ producerId, socketId, source });
      }
    });

    // One track went away without the peer leaving — how a screen share ends.
    socket.on("producer-closed", ({ producerId }: { producerId: string }) => {
      const entry = consumers.get(producerId);
      if (!entry) return;
      consumers.delete(producerId);
      entry.consumer.close();
      dropTrack(entry.socketId, entry.consumer.track, entry.source);
    });

    socket.on("peer-disconnected", ({ socketId }: { socketId: string }) => {
      setRemoteStreams(prev => prev.filter(s => s.socketId !== socketId));
      dropPeerScreen(socketId);
      for (const [producerId, entry] of consumers) {
        if (entry.socketId !== socketId) continue;
        entry.consumer.close();
        consumers.delete(producerId);
      }
      setRaisedHands(prev => {
        if (!prev.has(socketId)) return prev;
        const next = new Set(prev);
        next.delete(socketId);
        return next;
      });
    });

    socket.on("reaction", ({ socketId, emoji }: any) => {
      const isMe = socketId === socket.id;
      const label = isMe ? "You" : `Peer ${socketId.substring(0, 4)}`;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Spread spawn across the left third of the viewport so rapid reactions fan out.
      const x = 24 + Math.random() * (typeof window !== "undefined" ? window.innerWidth / 3 : 320);
      setReactions(prev => [...prev, { id, emoji, label, x }]);
    });

    socket.on("raiseHand", ({ socketId, raised }: any) => {
      setRaisedHands(prev => {
        const next = new Set(prev);
        if (raised) next.add(socketId);
        else next.delete(socketId);
        return next;
      });
    });

    return () => { socket.disconnect(); };
  }, []);

  // ─── Video call handlers ───────────────────────────────────────────────────
  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { alert("Camera requires HTTPS."); return; }
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
      setIsMediaActive(true);
    } catch (error) { console.error("Camera error:", error); }
  };

  const loadMediasoupDevice = async () => {
    const safeRoomId = decodeURIComponent(roomId).toUpperCase();
    socket.emit("joinRoom", { roomId: safeRoomId }, async ({ rtpCapabilities, error }: any) => {
      if (error) { 
        console.error("Join room failed:", error); 
        alert(error); // Show the "Room does not exist" error to the user
        router.push("/"); // Redirect them back to your home page
        return; 
      }
      const { Device } = await import("mediasoup-client");
      device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      await createSendTransport();
      await createRecvTransport();
      setDeviceLoaded(true);
    });
  };

  const createSendTransport = async () => {
    if (!device) throw new Error("Device not loaded");
    const d = device;
    const { params } = await new Promise<any>((resolve) =>
      socket.emit("createWebRtcTransport", { sender: true }, resolve)
    );
    sendTransport = d.createSendTransport(params);
    sendTransport.on("connect", async ({ dtlsParameters }: any, callback: any, errback: any) => {
      try { socket.emit("transport-connect", { dtlsParameters, isSender: true }); callback(); }
      catch (e) { errback(e); }
    });
    sendTransport.on("produce", async (parameters: any, callback: any, errback: any) => {
      try {
        // appData carries the track's `source` (camera / mic / screen /
        // screenAudio). mediasoup-client does not send it for us, and without
        // it the SFU cannot tell a screen share from a webcam.
        socket.emit(
          "transport-produce",
          {
            kind: parameters.kind,
            rtpParameters: parameters.rtpParameters,
            appData: parameters.appData,
          },
          ({ id }: any) => { callback({ id }); },
        );
      } catch (e) { errback(e); }
    });
  };

  const createRecvTransport = async () => {
    if (!device) throw new Error("Device not loaded");
    const d = device;
    const { params } = await new Promise<any>((resolve) =>
      socket.emit("createWebRtcTransport", { sender: false }, resolve)
    );
    recvTransport = d.createRecvTransport(params);
    recvTransport.on("connect", async ({ dtlsParameters }: any, callback: any, errback: any) => {
      try { socket.emit("transport-connect", { dtlsParameters, isSender: false }); callback(); }
      catch (e) { errback(e); }
    });
  };

  const produceMedia = async () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];
    if (videoTrack) videoProducer = await sendTransport.produce({ track: videoTrack, appData: { source: "camera" } });
    if (audioTrack) audioProducer = await sendTransport.produce({ track: audioTrack, appData: { source: "mic" } });
    setIsProducing(true);
    socket.emit("getProducers", (existing: { id: string; socketId: string; source?: MediaSource }[]) => {
      existing
        .filter(p => p.socketId !== socket.id)
        .forEach(p => consumeRemoteTrack({ producerId: p.id, socketId: p.socketId, source: p.source }));
    });
  };

  // ─── Incoming tracks ───────────────────────────────────────────────────────

  /** Camera and mic: merged into the peer's one participant stream. */
  const addCameraTrack = (socketId: string, track: MediaStreamTrack) => {
    setRemoteStreams(prev => {
      const idx = prev.findIndex(s => s.socketId === socketId);
      if (idx >= 0) {
        const existing = prev[idx]!;
        const updated = [...prev];
        updated[idx] = { socketId, stream: new MediaStream([...existing.stream.getTracks(), track]) };
        return updated;
      }
      return [...prev, { socketId, stream: new MediaStream([track]) }];
    });
  };

  /** Screen picture and its audio: a separate stream, keyed by presenter. */
  const addScreenTrack = (socketId: string, track: MediaStreamTrack) => {
    setScreenStreams(prev => {
      const existing = prev[socketId];
      return {
        ...prev,
        [socketId]: existing
          ? new MediaStream([...existing.getTracks(), track])
          : new MediaStream([track]),
      };
    });
  };

  const dropPeerScreen = (socketId: string) => {
    setScreenStreams(prev => {
      if (!prev[socketId]) return prev;
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  };

  const dropTrack = (socketId: string, track: MediaStreamTrack, source: MediaSource) => {
    // The picture ending means the presentation is over, audio included.
    if (isScreenVideoSource(source)) return dropPeerScreen(socketId);

    if (isScreenSource(source)) {
      setScreenStreams(prev => {
        const existing = prev[socketId];
        if (!existing) return prev;
        return { ...prev, [socketId]: new MediaStream(existing.getTracks().filter(t => t !== track)) };
      });
      return;
    }

    setRemoteStreams(prev =>
      prev.map(s =>
        s.socketId === socketId
          ? { socketId, stream: new MediaStream(s.stream.getTracks().filter(t => t !== track)) }
          : s,
      ),
    );
  };

  // The announcement's `kind` is deliberately ignored — `consumer.kind` is the
  // authoritative one, and it is what `source` has to be reconciled against.
  const consumeRemoteTrack = async ({ producerId, socketId, source }: ProducerInfo) => {
    if (!device || !recvTransport) return;
    if (consumers.has(producerId)) return; // `new-producer` can race `getProducers`
    const d = device; const rt = recvTransport;
    const result = await new Promise<any>((resolve) =>
      socket.emit("consume", { rtpCapabilities: d.rtpCapabilities, producerId }, resolve)
    );
    if (result.error) return;
    const consumer: TrackConsumer = await rt.consume(result.params);
    const trackSource = normalizeSource(source, consumer.kind);
    consumers.set(producerId, { consumer, socketId, source: trackSource });

    if (isScreenSource(trackSource)) addScreenTrack(socketId, consumer.track);
    else addCameraTrack(socketId, consumer.track);
  };

  const toggleMute = () => {
    const muting = !isMuted;
    if (audioProducer) muting ? audioProducer.pause() : audioProducer.resume();
    if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !muting; });
    setIsMuted(muting);
  };

  const toggleCamera = () => {
    const turningOff = !isCamOff;
    if (localStream) localStream.getVideoTracks().forEach(t => { t.enabled = !turningOff; });
    setIsCamOff(turningOff);
  };

  const endCall = async () => {
    // Stop presenting first: it needs the socket and transport to tell the SFU,
    // and it is what makes the browser's sharing bar go away.
    await screenShare.stop();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (sendTransport) { sendTransport.close(); sendTransport = null; }
    if (recvTransport) { recvTransport.close(); recvTransport = null; }
    consumers.clear();
    audioProducer = null; videoProducer = null; localStream = null; device = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setIsMediaActive(false); setDeviceLoaded(false); setIsProducing(false);
    setIsMuted(false); setIsCamOff(false); setRemoteStreams([]); setScreenStreams({});
    router.push("/");
  };

  // ─── Layout helpers ────────────────────────────────────────────────────────
  const selfLabel = `You${isMuted ? " (Muted)" : ""}${isCamOff ? " (Cam off)" : ""}`;
  const totalParticipants = (isMediaActive ? 1 : 0) + remoteStreams.length;
  // Picture-in-picture only when there is exactly one local + one remote, and
  // nobody is presenting (a presentation owns the stage instead).
  const isPipMode =
    isMediaActive && remoteStreams.length === 1 && totalParticipants === 2 && !activePresentation;

  const gridDims = gridFor(totalParticipants);

  // The board sidebar sizes its tiles from its measured box instead of letting
  // them stretch: it is tall and narrow, so a stretched tile becomes a long
  // vertical strip rather than a video.
  const { ref: sidebarTilesRef, grid: sidebarGrid } = useTileGrid(totalParticipants, SIDEBAR_TILE_GAP);

  /** The participant tiles, reused by the grid, the sidebar and the filmstrip. */
  const participantTiles = (tileClassName?: string, tileStyle?: CSSProperties) => (
    <>
      {isMediaActive && (
        <VideoTile
          videoRef={localVideoRef}
          label={selfLabel}
          muted
          isSelf
          handRaised={handRaised}
          className={tileClassName}
          style={tileStyle}
        />
      )}
      {remoteStreams.map((remote) => (
        <VideoTile
          key={remote.socketId}
          stream={remote.stream}
          label={labelFor(remote.socketId)}
          handRaised={raisedHands.has(remote.socketId)}
          className={tileClassName}
          style={tileStyle}
        />
      ))}
    </>
  );

  const stage = activePresentation && (
    <PresentationStage
      presenterLabel={labelFor(activePresentation.socketId)}
      surface={activePresentation.surface}
      stream={activeStream}
      isLocal={activePresentation.socketId === mySocketId}
      onStopPresenting={() => void screenShare.stop()}
      others={otherPresenters}
      onSelectPresenter={setPinnedPresenterId}
    />
  );

  /** Camera + Connect + Join. `compact` is the narrow whiteboard-sidebar variant. */
  const setupButtons = (compact: boolean) => (
    <div className={`flex flex-wrap justify-center ${compact ? "gap-2 mb-4" : "gap-3 mb-6"}`}>
      <button onClick={startCamera} disabled={isMediaActive}
        className={`rounded-lg font-semibold transition-all flex items-center ${compact ? "px-3 py-1.5 text-xs gap-1" : "px-4 py-2 text-sm gap-2"}`}
        style={{
          background: "var(--badge-bg)",
          color: isMediaActive ? "var(--text-tertiary)" : "var(--text-primary)",
          cursor: isMediaActive ? "not-allowed" : "pointer",
          opacity: isMediaActive ? 0.5 : 1,
        }}
      >
        <MIcon name="videocam" className={compact ? "!text-[14px]" : "!text-[18px]"} /> Camera
      </button>
      <button onClick={loadMediasoupDevice} disabled={!isMediaActive || deviceLoaded}
        className={`rounded-lg font-semibold transition-all flex items-center ${compact ? "px-3 py-1.5 text-xs gap-1" : "px-4 py-2 text-sm gap-2"}`}
        style={{
          background: (!isMediaActive || deviceLoaded) ? "var(--badge-bg)" : "#1a73e8",
          color: (!isMediaActive || deviceLoaded) ? "var(--text-tertiary)" : "#fff",
          cursor: (!isMediaActive || deviceLoaded) ? "not-allowed" : "pointer",
          opacity: (!isMediaActive || deviceLoaded) ? 0.5 : 1,
        }}
      >
        <MIcon name="link" className={compact ? "!text-[14px]" : "!text-[18px]"} /> Connect
      </button>
      <button onClick={produceMedia} disabled={!deviceLoaded || isProducing}
        className={`rounded-lg font-semibold transition-all flex items-center ${compact ? "px-3 py-1.5 text-xs gap-1" : "px-4 py-2 text-sm gap-2"}`}
        style={{
          background: (!deviceLoaded || isProducing) ? "var(--badge-bg)" : "#1e8e3e",
          color: (!deviceLoaded || isProducing) ? "var(--text-tertiary)" : "#fff",
          cursor: (!deviceLoaded || isProducing) ? "not-allowed" : "pointer",
          opacity: (!deviceLoaded || isProducing) ? 0.5 : 1,
        }}
      >
        <MIcon name="call" className={compact ? "!text-[14px]" : "!text-[18px]"} /> Join
      </button>
    </div>
  );

  return (
    <main className="flex h-screen flex-col overflow-hidden" style={{ background: "var(--app-bg)", color: "var(--text-primary)" }}>

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-5 py-2.5"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Collab Space
          </span>
          <span style={{ color: "var(--text-tertiary)" }}>|</span>
          <span
            className="font-mono text-sm px-2 py-0.5 rounded"
            style={{ color: "var(--text-secondary)", background: "var(--badge-bg)" }}
          >
            {roomId}
          </span>
          <div className="flex items-center gap-1.5 ml-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-red-500"}`} />
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {isConnected ? "Connected" : "Offline"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Board / Video toggle */}
          <button
            onClick={() => setShowWhiteboard(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: showWhiteboard ? "var(--toolbar-btn-active)" : "var(--badge-bg)",
              color: showWhiteboard ? "var(--toolbar-btn-active-text)" : "var(--text-secondary)",
            }}
          >
            <MIcon name={showWhiteboard ? "videocam" : "draw"} className="!text-[18px]" />
            {showWhiteboard ? "Video" : "Board"}
          </button>

          {/* Settings gear */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettings(v => !v)}
              className="meet-btn !w-9 !h-9"
              title="Settings"
            >
              <MIcon name="settings" className="!text-[20px]" />
            </button>
            {showSettings && (
              <div className="settings-dropdown">
                <div className="settings-dropdown-item">
                  <span className="flex items-center gap-2">
                    <MIcon name={theme === "dark" ? "dark_mode" : "light_mode"} className="!text-[20px]" />
                    Theme
                  </span>
                  <button
                    className={`theme-toggle ${theme === "dark" ? "dark" : ""}`}
                    onClick={() => setTheme(t => t === "light" ? "dark" : "light")}
                    aria-label="Toggle theme"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Area ───────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-row overflow-hidden min-h-0">

        {/* ── Video panel ───────────────────────────────────────────────────── */}
        {!showWhiteboard ? (
          <div className="flex-1 flex flex-col overflow-auto p-6">
            {/* Setup buttons — shown before producing */}
            {!isProducing && setupButtons(false)}

            {/* Video stage */}
            {activePresentation ? (
              // Someone is presenting: the screen takes the stage and the
              // people move to a filmstrip beside it.
              <div className="flex-1 min-h-0 flex gap-3">
                <div className="flex-1 min-w-0">{stage}</div>
                {totalParticipants > 0 && (
                  <div className="w-52 shrink-0 flex flex-col gap-3 overflow-y-auto">
                    {participantTiles("aspect-video shrink-0")}
                  </div>
                )}
              </div>
            ) : !isMediaActive && remoteStreams.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center" style={{ color: "var(--text-tertiary)" }}>
                <MIcon name="videocam_off" className="!text-[48px] mb-3" />
                <p className="text-sm">Start camera to join the call</p>
              </div>
            ) : isPipMode ? (
              // 2 people: remote fills the stage, local is a small bottom-right PiP.
              <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden bg-black" style={{ border: "1px solid var(--border)" }}>
                {remoteStreams[0] && (
                  <>
                    <span className="absolute top-3 left-3 bg-black/60 text-white px-2 py-1 rounded text-xs z-10">
                      {labelFor(remoteStreams[0].socketId)}
                    </span>
                    {raisedHands.has(remoteStreams[0].socketId) && <div className="hand-raised-badge">✋</div>}
                    <RemoteVideo stream={remoteStreams[0].stream} />
                  </>
                )}
                {/* Local PiP */}
                <VideoTile
                  videoRef={localVideoRef}
                  label={selfLabel}
                  muted
                  isSelf
                  handRaised={handRaised}
                  className="absolute bottom-4 right-4 w-48 md:w-56 lg:w-64 aspect-video shadow-2xl"
                />
              </div>
            ) : (
              // 1 alone, or 3+ — equal-sized tiles in a calculated grid.
              <div
                className="flex-1 min-h-0 grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(${gridDims.cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${gridDims.rows}, minmax(0, 1fr))`,
                }}
              >
                {participantTiles()}
              </div>
            )}
          </div>
        ) : (
          /* ── Left video panel when whiteboard is open ─────────────────────── */
          <div
            className="flex-1 flex flex-col p-4 overflow-hidden min-h-0"
            style={{ borderRight: "1px solid var(--border)", background: "var(--app-bg)" }}
          >
            {/* Compact setup buttons */}
            {!isProducing && setupButtons(true)}

            {/* The presentation keeps its full width and 16:9 shape — it is the
                thing people are reading. Capped at half the column so it can
                never squeeze the participants out; the stage letterboxes
                (object-contain) rather than distorting when that cap bites. */}
            {activePresentation && (
              <div className="aspect-video max-h-[50%] mb-4 shrink-0">{stage}</div>
            )}

            <p className="text-[10px] font-mono uppercase tracking-widest mb-3 text-center shrink-0" style={{ color: "var(--text-tertiary)" }}>
              Participants
            </p>

            {/* Participants share whatever height is left, so the column never
                scrolls: more people just means smaller tiles. Their size comes
                from measuring this box (`useTileGrid`) rather than from
                stretching, which is what keeps every tile 16:9 — two people in
                a tall column get a row of two landscape tiles, not two long
                vertical strips. */}
            {totalParticipants > 0 ? (
              <div ref={sidebarTilesRef} className="flex-1 min-h-0 overflow-hidden">
                <div
                  className="grid justify-center content-start"
                  style={{
                    gap: SIDEBAR_TILE_GAP,
                    gridTemplateColumns: `repeat(${sidebarGrid.cols}, ${sidebarGrid.width}px)`,
                  }}
                >
                  {participantTiles(undefined, { height: sidebarGrid.height })}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center" style={{ color: "var(--text-tertiary)" }}>
                <MIcon name="videocam_off" className="!text-[36px] mb-2" />
                <p className="text-xs">No participants</p>
              </div>
            )}
          </div>
        )}

        {/* ── Whiteboard panel ─────────────────────────────────────────────── */}
        {showWhiteboard && socketInstance && (
          <div className="w-[60%] flex items-center justify-center p-4" style={{ background: "var(--app-bg)" }}>
            <div className="w-full h-[80vh] flex flex-col overflow-hidden rounded-xl" style={{ border: "1px solid var(--border)" }}>
              <Whiteboard socket={socketInstance} theme={theme} />
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom Control Bar (Google Meet style) ──────────────────────────── */}
      {isProducing && (
        <div
          className="flex items-center justify-center gap-3 px-6 py-3"
          style={{ background: "var(--control-bar-bg)", borderTop: "1px solid var(--border)" }}
        >
          {/* Mic */}
          <button
            onClick={toggleMute}
            className={`meet-btn ${isMuted ? "active-off" : ""}`}
            title={isMuted ? "Unmute" : "Mute"}
          >
            <MIcon name={isMuted ? "mic_off" : "mic"} />
          </button>

          {/* Camera */}
          <button
            onClick={toggleCamera}
            className={`meet-btn ${isCamOff ? "active-off" : ""}`}
            title={isCamOff ? "Turn on camera" : "Turn off camera"}
          >
            <MIcon name={isCamOff ? "videocam_off" : "videocam"} />
          </button>

          {/* Present now */}
          <ScreenShareButton screenShare={screenShare} disabled={!deviceLoaded} />

          {/* Hand raise */}
          <button
            onClick={() => {
              const next = !handRaised;
              setHandRaised(next);
              socket?.emit("raiseHand", { raised: next });
            }}
            className="meet-btn"
            title={handRaised ? "Lower hand" : "Raise hand"}
            style={handRaised ? { background: "#fde293", color: "#1f1f1f" } : {}}
          >
            <MIcon name="front_hand" />
          </button>

          {/* Reactions */}
          <div className="relative" ref={reactionsRef}>
            <button
              onClick={() => setShowReactions(v => !v)}
              className="meet-btn"
              title="Reactions"
            >
              <MIcon name="sentiment_satisfied" />
            </button>
            {showReactions && (
              <div className="reactions-popover">
                {REACTIONS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => {
                      socket?.emit("reaction", { emoji });
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* End Call */}
          <button onClick={() => void endCall()} className="meet-btn meet-btn--end" title="Leave call">
            <MIcon name="call_end" />
          </button>
        </div>
      )}

      <ReactionOverlay reactions={reactions} onComplete={removeReaction} />
    </main>
  );
}

// ─── Dedicated Video Component to prevent flickering ─────────────────────────
// Still used by the PiP layout, where the remote fills the container rather
// than sitting in a tile of its own.
const RemoteVideo = ({ stream }: { stream: MediaStream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
};
