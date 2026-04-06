"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import Whiteboard from "../../components/Whiteboard";

// ─── Mediasoup globals ────────────────────────────────────────────────────────
let socket: Socket;
let device: any;
let sendTransport: any;
let recvTransport: any;
let localStream: MediaStream | null;
let audioProducer: any;
let videoProducer: any;

// ─── Material Symbol helper ──────────────────────────────────────────────────
const MIcon = ({ name, className = "" }: { name: string; className?: string }) => (
  <span className={`material-symbols-rounded ${className}`} style={{ fontSize: 24 }}>
    {name}
  </span>
);

// ─── Floating Reaction System ────────────────────────────────────────────────
function triggerReaction(emoji: string) {
  const el = document.createElement("div");
  el.className = "floating-reaction";
  el.textContent = emoji;
  // randomize horizontal offset slightly
  el.style.left = `${20 + Math.random() * 40}px`;
  el.style.bottom = "100px";
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

// ─── Dedicated Video Component to prevent flickering ─────────────────────────
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

// ─── Reactions Emoji List ────────────────────────────────────────────────────
const REACTIONS = ["👍", "❤️", "😂", "🎉", "😮"];

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

  // ─── UI state ──────────────────────────────────────────────────────────────
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [showSettings, setShowSettings] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const reactionsRef = useRef<HTMLDivElement>(null);

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

  // Re-attach local stream whenever the video element mounts or remounts
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [showWhiteboard, isMediaActive]);

  // ─── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sfuUrl = process.env.NEXT_PUBLIC_SFU_URL || "http://localhost:4000";
    socket = io(sfuUrl, {
      transports: ["websocket"],
      secure: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => { setIsConnected(true); setSocketReady(true); });
    socket.on("disconnect", () => setIsConnected(false));
    socket.on("connect_error", (err) => console.error("Socket error:", err.message));

    socket.on("new-producer", ({ producerId, socketId, kind }: any) => {
      if (device && recvTransport && socketId !== socket.id) consumeRemoteTrack({ producerId, socketId, kind });
    });
    socket.on("peer-disconnected", ({ socketId }: any) => {
      setRemoteStreams(prev => prev.filter(s => s.socketId !== socketId));
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
    socket.emit("joinRoom", { roomId }, async ({ rtpCapabilities, error }: any) => {
      if (error) { console.error("Join room failed:", error); return; }
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
        socket.emit("transport-produce", { kind: parameters.kind, rtpParameters: parameters.rtpParameters }, ({ id }: any) => { callback({ id }); });
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
    if (videoTrack) videoProducer = await sendTransport.produce({ track: videoTrack });
    if (audioTrack) audioProducer = await sendTransport.produce({ track: audioTrack });
    setIsProducing(true);
    socket.emit("getProducers", (existing: any[]) => {
      existing.filter(p => p.socketId !== socket.id).forEach(p => consumeRemoteTrack({ producerId: p.id, socketId: p.socketId, kind: p.kind }));
    });
  };

  const consumeRemoteTrack = async ({ producerId, socketId, kind }: any) => {
    if (!device || !recvTransport) return;
    const d = device; const rt = recvTransport;
    const result = await new Promise<any>((resolve) =>
      socket.emit("consume", { rtpCapabilities: d.rtpCapabilities, producerId }, resolve)
    );
    if (result.error) return;
    const consumer = await rt.consume(result.params);
    setRemoteStreams(prev => {
      const idx = prev.findIndex(s => s.socketId === socketId);
      if (idx >= 0) {
        const existing = prev[idx]!;
        const newStream = new MediaStream([...existing.stream.getTracks(), consumer.track]);
        const updated = [...prev];
        updated[idx] = { socketId, stream: newStream };
        return updated;
      }
      return [...prev, { socketId, stream: new MediaStream([consumer.track]) }];
    });
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

  const endCall = () => {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (sendTransport) { sendTransport.close(); sendTransport = null; }
    if (recvTransport) { recvTransport.close(); recvTransport = null; }
    audioProducer = null; videoProducer = null; localStream = null; device = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setIsMediaActive(false); setDeviceLoaded(false); setIsProducing(false);
    setIsMuted(false); setIsCamOff(false); setRemoteStreams([]);
    router.push("/");
  };

  // ─── Quick setup: Camera + Connect + Join in one click ─────────────────────
  const quickStart = async () => {
    if (!isMediaActive) await startCamera();
  };

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
          <div className="flex-1 flex flex-col overflow-auto" style={{ padding: showWhiteboard ? "16px" : "24px" }}>
            {/* Setup buttons — shown before producing */}
            {!isProducing && (
              <div className="flex flex-wrap justify-center gap-3 mb-6">
                <button onClick={startCamera} disabled={isMediaActive}
                  className="px-4 py-2 rounded-lg font-semibold text-sm transition-all flex items-center gap-2"
                  style={{
                    background: isMediaActive ? "var(--badge-bg)" : "var(--badge-bg)",
                    color: isMediaActive ? "var(--text-tertiary)" : "var(--text-primary)",
                    cursor: isMediaActive ? "not-allowed" : "pointer",
                    opacity: isMediaActive ? 0.5 : 1,
                  }}
                >
                  <MIcon name="videocam" className="!text-[18px]" /> Camera
                </button>
                <button onClick={loadMediasoupDevice} disabled={!isMediaActive || deviceLoaded}
                  className="px-4 py-2 rounded-lg font-semibold text-sm transition-all flex items-center gap-2"
                  style={{
                    background: (!isMediaActive || deviceLoaded) ? "var(--badge-bg)" : "#1a73e8",
                    color: (!isMediaActive || deviceLoaded) ? "var(--text-tertiary)" : "#fff",
                    cursor: (!isMediaActive || deviceLoaded) ? "not-allowed" : "pointer",
                    opacity: (!isMediaActive || deviceLoaded) ? 0.5 : 1,
                  }}
                >
                  <MIcon name="link" className="!text-[18px]" /> Connect
                </button>
                <button onClick={produceMedia} disabled={!deviceLoaded || isProducing}
                  className="px-4 py-2 rounded-lg font-semibold text-sm transition-all flex items-center gap-2"
                  style={{
                    background: (!deviceLoaded || isProducing) ? "var(--badge-bg)" : "#1e8e3e",
                    color: (!deviceLoaded || isProducing) ? "var(--text-tertiary)" : "#fff",
                    cursor: (!deviceLoaded || isProducing) ? "not-allowed" : "pointer",
                    opacity: (!deviceLoaded || isProducing) ? 0.5 : 1,
                  }}
                >
                  <MIcon name="call" className="!text-[18px]" /> Join
                </button>
              </div>
            )}

            {/* Video grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {isMediaActive && (
                <div className="relative aspect-video bg-black rounded-xl overflow-hidden border-2 border-emerald-500/50">
                  <span className="absolute top-2 left-2 bg-black/60 text-white px-2 py-1 rounded text-xs z-10">
                    You{isMuted ? " (Muted)" : ""}{isCamOff ? " (Cam off)" : ""}
                  </span>
                  <video ref={localVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                </div>
              )}
              {remoteStreams.map((remote) => (
                <div key={remote.socketId} className="relative aspect-video bg-black rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  <span className="absolute top-2 left-2 bg-black/60 text-white px-2 py-1 rounded text-xs z-10">
                    Peer ({remote.socketId.substring(0, 4)})
                  </span>
                  <RemoteVideo stream={remote.stream} />
                </div>
              ))}
              {!isMediaActive && remoteStreams.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center h-64" style={{ color: "var(--text-tertiary)" }}>
                  <MIcon name="videocam_off" className="!text-[48px] mb-3" />
                  <p className="text-sm">Start camera to join the call</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Left video panel when whiteboard is open ─────────────────────── */
          <div
            className="flex-1 flex flex-col p-4 overflow-auto"
            style={{ borderRight: "1px solid var(--border)", background: "var(--app-bg)" }}
          >
            {/* Compact setup buttons */}
            {!isProducing && (
              <div className="flex flex-wrap justify-center gap-2 mb-4">
                <button onClick={startCamera} disabled={isMediaActive}
                  className="px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1"
                  style={{
                    background: "var(--badge-bg)",
                    color: isMediaActive ? "var(--text-tertiary)" : "var(--text-primary)",
                    opacity: isMediaActive ? 0.5 : 1,
                    cursor: isMediaActive ? "not-allowed" : "pointer",
                  }}
                >
                  <MIcon name="videocam" className="!text-[14px]" /> Camera
                </button>
                <button onClick={loadMediasoupDevice} disabled={!isMediaActive || deviceLoaded}
                  className="px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1"
                  style={{
                    background: (!isMediaActive || deviceLoaded) ? "var(--badge-bg)" : "#1a73e8",
                    color: (!isMediaActive || deviceLoaded) ? "var(--text-tertiary)" : "#fff",
                    opacity: (!isMediaActive || deviceLoaded) ? 0.5 : 1,
                    cursor: (!isMediaActive || deviceLoaded) ? "not-allowed" : "pointer",
                  }}
                >
                  <MIcon name="link" className="!text-[14px]" /> Connect
                </button>
                <button onClick={produceMedia} disabled={!deviceLoaded || isProducing}
                  className="px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1"
                  style={{
                    background: (!deviceLoaded || isProducing) ? "var(--badge-bg)" : "#1e8e3e",
                    color: (!deviceLoaded || isProducing) ? "var(--text-tertiary)" : "#fff",
                    opacity: (!deviceLoaded || isProducing) ? 0.5 : 1,
                    cursor: (!deviceLoaded || isProducing) ? "not-allowed" : "pointer",
                  }}
                >
                  <MIcon name="call" className="!text-[14px]" /> Join
                </button>
              </div>
            )}

            <p className="text-[10px] font-mono uppercase tracking-widest mb-3 text-center" style={{ color: "var(--text-tertiary)" }}>
              Participants
            </p>
            <div className="flex flex-col gap-3">
              {isMediaActive && (
                <div className="relative aspect-video bg-black rounded-xl overflow-hidden border-2 border-emerald-500/50">
                  <span className="absolute top-2 left-2 bg-black/60 text-white px-2 py-1 rounded text-xs z-10">
                    You{isMuted ? " (Muted)" : ""}
                  </span>
                  <video ref={localVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                </div>
              )}
              {remoteStreams.map((remote) => (
                <div key={remote.socketId} className="relative aspect-video bg-black rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  <span className="absolute top-2 left-2 bg-black/60 text-white px-2 py-1 rounded text-xs z-10">
                    Peer ({remote.socketId.substring(0, 4)})
                  </span>
                  <RemoteVideo stream={remote.stream} />
                </div>
              ))}
              {!isMediaActive && remoteStreams.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10" style={{ color: "var(--text-tertiary)" }}>
                  <MIcon name="videocam_off" className="!text-[36px] mb-2" />
                  <p className="text-xs">No participants</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Whiteboard panel ─────────────────────────────────────────────── */}
        {showWhiteboard && socketReady && (
          <div className="w-[60%] flex items-center justify-center p-4" style={{ background: "var(--app-bg)" }}>
            <div className="w-full h-[80vh] flex flex-col overflow-hidden rounded-xl" style={{ border: "1px solid var(--border)" }}>
              <Whiteboard socket={socket} theme={theme} />
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

          {/* Hand raise */}
          <button
            onClick={() => setHandRaised(h => !h)}
            className="meet-btn"
            title={handRaised ? "Lower hand" : "Raise hand"}
            style={handRaised ? { background: "#fde293", color: "#1f1f1f" } : {}}
          >
            <MIcon name={handRaised ? "front_hand" : "front_hand"} />
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
                      triggerReaction(emoji);
                      setShowReactions(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* End Call */}
          <button onClick={endCall} className="meet-btn meet-btn--end" title="Leave call">
            <MIcon name="call_end" />
          </button>
        </div>
      )}
    </main>
  );
}
