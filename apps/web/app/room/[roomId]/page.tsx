"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { Device } from "mediasoup-client";
import Whiteboard from "../../components/Whiteboard";

export const runtime = "edge";

// ─── Mediasoup globals ────────────────────────────────────────────────────────
let socket: Socket;
let device: Device | null;
let sendTransport: any;
let recvTransport: any;
let localStream: MediaStream | null;
let audioProducer: any;
let videoProducer: any;

// ─── Dedicated Video Component to prevent flickering ─────────────────────────
const RemoteVideo = ({ stream }: { stream: MediaStream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
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

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();

  // ─── Video call state ──────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);
  const [isMediaActive, setIsMediaActive] = useState(false);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<{ socketId: string; stream: MediaStream }[]>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  // ─── Whiteboard toggle state ───────────────────────────────────────────────
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [socketReady, setSocketReady] = useState(false);

  // Re-attach local stream whenever the video element mounts or remounts
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [showWhiteboard, isMediaActive]);

  // ─── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    const sfuUrl = process.env.NEXT_PUBLIC_SFU_URL || "https://188.166.209.187.nip.io";
    socket = io(sfuUrl, {
      transports: ["polling", "websocket"],
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

  const endCall = () => {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (sendTransport) { sendTransport.close(); sendTransport = null; }
    if (recvTransport) { recvTransport.close(); recvTransport = null; }
    audioProducer = null; videoProducer = null; localStream = null; device = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setIsMediaActive(false); setDeviceLoaded(false); setIsProducing(false);
    setIsMuted(false); setRemoteStreams([]);
    router.push("/");
  };

  return (
    <main className="flex h-screen flex-col bg-[#0d0f1a] text-white overflow-hidden">
      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-[#111320]">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight text-white">Collab</span>
          <span className="text-white/30 text-lg">·</span>
          <span className="font-mono text-sm text-white/50 bg-white/5 px-2 py-0.5 rounded">{roomId}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-red-500"}`} />
          <span className="text-xs text-white/40">{isConnected ? "Live" : "Offline"}</span>
          <button
            onClick={() => setShowWhiteboard(v => !v)}
            className={`ml-4 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${showWhiteboard ? "bg-indigo-500 text-white" : "bg-white/10 text-white/70 hover:bg-white/15"}`}
          >
            {showWhiteboard ? "📹 Video" : "🖊 Board"}
          </button>
        </div>
      </header>

      {/* ── Main Area ───────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-row overflow-hidden min-h-0">

        {/* ── Video panel ───────────────────────────────────────────────────── */}
        {!showWhiteboard ? (
          <div className="flex-1 flex flex-col p-6 overflow-auto">
            <div className="flex flex-wrap justify-center gap-3 mb-6">
              <button onClick={startCamera} disabled={isMediaActive}
                className={`px-4 py-2 rounded-lg font-semibold text-sm shadow-md transition-all
                  ${isMediaActive ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-white/10 hover:bg-white/15 text-white"}`}>
                📷 Camera
              </button>
              <button onClick={loadMediasoupDevice} disabled={!isMediaActive || deviceLoaded}
                className={`px-4 py-2 rounded-lg font-semibold text-sm shadow-md transition-all
                  ${!isMediaActive || deviceLoaded ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500 text-white"}`}>
                🔗 Connect
              </button>
              <button onClick={produceMedia} disabled={!deviceLoaded || isProducing}
                className={`px-4 py-2 rounded-lg font-semibold text-sm shadow-md transition-all
                  ${!deviceLoaded || isProducing ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}>
                🎥 Join
              </button>
              {isProducing && (
                <>
                  <button onClick={toggleMute}
                    className={`px-4 py-2 rounded-lg font-semibold text-sm shadow-md transition-all
                      ${isMuted ? "bg-yellow-500/80 text-white" : "bg-indigo-600 hover:bg-indigo-500 text-white"}`}>
                    {isMuted ? "🔇 Unmute" : "🎤 Mute"}
                  </button>
                  <button onClick={endCall}
                    className="px-4 py-2 rounded-lg font-semibold text-sm bg-red-600 hover:bg-red-500 text-white shadow-md transition-all">
                    📵 End Call
                  </button>
                </>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {isMediaActive && (
                <div className="relative aspect-video bg-black rounded-xl overflow-hidden border-2 border-emerald-500/50">
                  <span className="absolute top-2 left-2 bg-black/60 text-white px-2 py-1 rounded text-xs z-10">
                    You{isMuted ? " (Muted)" : ""}
                  </span>
                  <video ref={localVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                </div>
              )}
              {remoteStreams.map((remote) => (
                <div key={remote.socketId} className="relative aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
                  <span className="absolute top-2 left-2 bg-black/60 text-white px-2 py-1 rounded text-xs z-10">
                    Peer ({remote.socketId.substring(0, 4)})
                  </span>
                  <RemoteVideo stream={remote.stream} />
                </div>
              ))}
              {!isMediaActive && remoteStreams.length === 0 && (
                <div className="col-span-full flex flex-col items-center justify-center h-64 text-white/20">
                  <div className="text-5xl mb-3">📹</div>
                  <p className="text-sm">Start camera to join the call</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Left video panel when whiteboard is open ─────────────────────── */
          <div className="flex-1 flex flex-col p-4 overflow-auto border-r border-white/10 bg-[#0d0f1a]">
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              <button onClick={startCamera} disabled={isMediaActive}
                className={`px-3 py-1.5 rounded-lg font-semibold text-xs shadow-md transition-all
                  ${isMediaActive ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-white/10 hover:bg-white/15 text-white"}`}>
                📷 Camera
              </button>
              <button onClick={loadMediasoupDevice} disabled={!isMediaActive || deviceLoaded}
                className={`px-3 py-1.5 rounded-lg font-semibold text-xs shadow-md transition-all
                  ${!isMediaActive || deviceLoaded ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500 text-white"}`}>
                🔗 Connect
              </button>
              <button onClick={produceMedia} disabled={!deviceLoaded || isProducing}
                className={`px-3 py-1.5 rounded-lg font-semibold text-xs shadow-md transition-all
                  ${!deviceLoaded || isProducing ? "bg-white/10 text-white/30 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}>
                🎥 Join
              </button>
              {isProducing && (
                <>
                  <button onClick={toggleMute}
                    className={`px-3 py-1.5 rounded-lg font-semibold text-xs shadow-md transition-all
                      ${isMuted ? "bg-yellow-500/80 text-white" : "bg-indigo-600 hover:bg-indigo-500 text-white"}`}>
                    {isMuted ? "🔇 Unmute" : "🎤 Mute"}
                  </button>
                  <button onClick={endCall}
                    className="px-3 py-1.5 rounded-lg font-semibold text-xs bg-red-600 hover:bg-red-500 text-white shadow-md transition-all">
                    📵 End
                  </button>
                </>
              )}
            </div>

            <p className="text-[10px] text-white/30 font-mono uppercase tracking-widest mb-3 text-center">Participants</p>
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
                <div key={remote.socketId} className="relative aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
                  <span className="absolute top-2 left-2 bg-black/60 text-white px-2 py-1 rounded text-xs z-10">
                    Peer ({remote.socketId.substring(0, 4)})
                  </span>
                  <RemoteVideo stream={remote.stream} />
                </div>
              ))}
              {!isMediaActive && remoteStreams.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-white/20">
                  <div className="text-4xl mb-2">📹</div>
                  <p className="text-xs">No participants</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Whiteboard panel — right side, 60% width, 80% height ─────────── */}
        {showWhiteboard && socketReady && (
          <div className="w-[60%] flex items-center justify-center bg-[#0d0f1a] p-4">
            <div className="w-full h-[80vh] flex flex-col overflow-hidden rounded-xl border border-white/10">
              <Whiteboard socket={socket} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
