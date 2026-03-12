"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Device } from "mediasoup-client";

let socket: Socket;
let device: Device | null;
let sendTransport: any;
let recvTransport: any;
let localStream: MediaStream | null;
let audioProducer: any;
let videoProducer: any;

//testing github

export default function MeetingLobby() {
  const [isConnected, setIsConnected] = useState(false);
  const [isMediaActive, setIsMediaActive] = useState(false);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Each peer gets one stream containing both audio + video tracks
  const [remoteStreams, setRemoteStreams] = useState<{ socketId: string; stream: MediaStream }[]>([]);

  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    socket = io(`http://${window.location.hostname}:4000`);

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    socket.on("new-producer", ({ producerId, socketId, kind }: { producerId: string; socketId: string; kind: string }) => {
      // Only consume if we've already set up our transports
      if (device && recvTransport) consumeRemoteTrack({ producerId, socketId, kind });
    });

    return () => { socket.disconnect(); };
  }, []);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Camera access requires HTTPS or localhost.\n\nIn Chrome, enable: chrome://flags/#unsafely-treat-insecure-origin-as-secure");
      return;
    }
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
      setIsMediaActive(true);
    } catch (error) { console.error("Error accessing media:", error); }
  };

  const loadMediasoupDevice = async () => {
    socket.emit('getRouterRtpCapabilities', async (routerRtpCapabilities: any) => {
      device = new Device();
      await device.load({ routerRtpCapabilities });
      await createSendTransport();
      await createRecvTransport();
      setDeviceLoaded(true);
    });
  };

  const createSendTransport = async () => {
    if (!device) throw new Error("Mediasoup device not loaded yet.");
    const d = device;
    const { params } = await new Promise<any>((resolve) =>
      socket.emit('createWebRtcTransport', { sender: true }, resolve)
    );
    sendTransport = d.createSendTransport(params);

    sendTransport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
      try {
        socket.emit('transport-connect', { dtlsParameters, isSender: true });
        callback();
      } catch (error) { errback(error); }
    });

    sendTransport.on('produce', async (parameters: any, callback: any, errback: any) => {
      try {
        socket.emit('transport-produce', { kind: parameters.kind, rtpParameters: parameters.rtpParameters }, ({ id }: any) => {
          callback({ id });
        });
      } catch (error) { errback(error); }
    });
  };

  const createRecvTransport = async () => {
    if (!device) throw new Error("Mediasoup device not loaded yet.");
    const d = device;
    const { params } = await new Promise<any>((resolve) =>
      socket.emit('createWebRtcTransport', { sender: false }, resolve)
    );
    recvTransport = d.createRecvTransport(params);

    recvTransport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
      try {
        socket.emit('transport-connect', { dtlsParameters, isSender: false });
        callback();
      } catch (error) { errback(error); }
    });
  };

  const produceMedia = async () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    const audioTrack = localStream.getAudioTracks()[0];

    if (videoTrack) videoProducer = await sendTransport.produce({ track: videoTrack });
    if (audioTrack) audioProducer = await sendTransport.produce({ track: audioTrack });

    setIsProducing(true);

    // Consume tracks from peers already in the room
    socket.emit("getProducers", (existingProducers: { id: string; socketId: string; kind: string }[]) => {
      existingProducers.forEach(p => consumeRemoteTrack({ producerId: p.id, socketId: p.socketId, kind: p.kind }));
    });
  };

  const consumeRemoteTrack = async ({ producerId, socketId, kind }: { producerId: string; socketId: string; kind: string }) => {
    if (!device || !recvTransport) {
      console.warn("Cannot consume track yet (device/recvTransport not ready).", { producerId, socketId, kind });
      return;
    }
    const d = device;
    const rt = recvTransport;

    const result = await new Promise<any>((resolve) =>
      socket.emit('consume', { rtpCapabilities: d.rtpCapabilities, producerId }, resolve)
    );

    if (result.error) { console.error('Cannot consume:', result.error); return; }

    const consumer = await rt.consume(result.params);

    // Merge audio + video from the same peer into a single MediaStream
    setRemoteStreams(prev => {
      const existingIndex = prev.findIndex(s => s.socketId === socketId);
      if (existingIndex >= 0) {
        const existing = prev[existingIndex]!;
        const newStream = new MediaStream([...existing.stream.getTracks(), consumer.track]);
        const updated = [...prev];
        updated[existingIndex] = { socketId, stream: newStream };
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
    audioProducer = null;
    videoProducer = null;
    localStream = null;
    device = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setIsMediaActive(false);
    setDeviceLoaded(false);
    setIsProducing(false);
    setIsMuted(false);
    setRemoteStreams([]);
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-gray-50 p-6">
      <div className="w-full max-w-5xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">Collab Space</h1>

        {/* Controls */}
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          <button onClick={startCamera} disabled={isMediaActive}
            className={`px-4 py-2 rounded-lg font-semibold text-white shadow-md ${isMediaActive ? 'bg-gray-400' : 'bg-gray-800'}`}>
            1. Camera
          </button>
          <button onClick={loadMediasoupDevice} disabled={!isMediaActive || deviceLoaded}
            className={`px-4 py-2 rounded-lg font-semibold text-white shadow-md ${!isMediaActive || deviceLoaded ? 'bg-gray-400' : 'bg-blue-600'}`}>
            2. Connect
          </button>
          <button onClick={produceMedia} disabled={!deviceLoaded || isProducing}
            className={`px-4 py-2 rounded-lg font-semibold text-white shadow-md ${!deviceLoaded || isProducing ? 'bg-gray-400' : 'bg-green-600'}`}>
            3. Join Meeting
          </button>

          {isProducing && (
            <>
              <button onClick={toggleMute}
                className={`px-4 py-2 rounded-lg font-semibold text-white shadow-md ${isMuted ? 'bg-yellow-500' : 'bg-indigo-600'}`}>
                {isMuted ? 'Unmute Mic' : 'Mute Mic'}
              </button>
              <button onClick={endCall}
                className="px-4 py-2 rounded-lg font-semibold text-white shadow-md bg-red-600">
                End Call
              </button>
            </>
          )}
        </div>

        {/* Status */}
        <p className="text-center text-sm text-gray-500 mb-6">
          {isConnected ? 'Connected to server' : 'Disconnected'}
          {isProducing && isMuted && ' · Mic muted'}
        </p>

        {/* Video Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Local Video */}
          {isMediaActive && (
            <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden shadow-lg border-2 border-green-500">
              <span className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs z-10">
                You{isMuted ? ' (Muted)' : ''}
              </span>
              <video ref={localVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
            </div>
          )}

          {/* Remote Videos */}
          {remoteStreams.map((remote) => (
            <div key={remote.socketId} className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden shadow-lg border border-gray-200">
              <span className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs z-10">
                Peer ({remote.socketId.substring(0, 4)})
              </span>
              <video
                autoPlay playsInline
                ref={video => { if (video) video.srcObject = remote.stream; }}
                className="absolute inset-0 w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
