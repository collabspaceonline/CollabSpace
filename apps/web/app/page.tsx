"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Device } from "mediasoup-client";

let socket: Socket;
let device: Device;
let sendTransport: any;
let recvTransport: any;
let localStream: MediaStream;

export default function MeetingLobby() {
  const [isConnected, setIsConnected] = useState(false);
  const [isMediaActive, setIsMediaActive] = useState(false);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  
  // Track other people's video streams!
  const [remoteStreams, setRemoteStreams] = useState<{ id: string; stream: MediaStream }[]>([]);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    socket = io("http://localhost:4000"); 

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    // Listen for new people pushing video!
    socket.on("new-producer", (producerId: string) => {
      console.log("🎥 New person joined! Consuming their video...");
      consumeRemoteVideo(producerId);
    });

    return () => { socket.disconnect(); };
  }, []);

  const startCamera = async () => {
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
      setDeviceLoaded(true);
      createSendTransport(); // Automatically build pipeline after device loads
    });
  };

  const createSendTransport = async () => {
    socket.emit('createWebRtcTransport', { sender: true }, ({ params }: any) => {
      sendTransport = device.createSendTransport(params);

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
    });
  };

  // NEW: Push your video to the server!
  const produceVideo = async () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    await sendTransport.produce({ track: videoTrack });
    setIsProducing(true);
    
    // Check if anyone was already in the room before us
    socket.emit("getProducers", (producerIds: string[]) => {
      producerIds.forEach(id => consumeRemoteVideo(id));
    });
  };

  // NEW: Download someone else's video from the server!
  const consumeRemoteVideo = async (producerId: string) => {
    // 1. Build a receiving pipeline if we don't have one yet
    if (!recvTransport) {
      const { params } = await new Promise<any>((resolve) => socket.emit('createWebRtcTransport', { sender: false }, resolve));
      recvTransport = device.createRecvTransport(params);
      
      recvTransport.on('connect', async ({ dtlsParameters }: any, callback: any, errback: any) => {
        try {
          socket.emit('transport-connect', { dtlsParameters, isSender: false });
          callback();
        } catch (error) { errback(error); }
      });
    }

    // 2. Ask server to consume the specific video
    const { params } = await new Promise<any>((resolve) => {
      socket.emit('consume', { rtpCapabilities: device.rtpCapabilities, producerId }, resolve);
    });

    // 3. Play the video locally
    const consumer = await recvTransport.consume(params);
    const newStream = new MediaStream([consumer.track]);
    
    setRemoteStreams(prev => [...prev, { id: producerId, stream: newStream }]);
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-gray-50 p-6">
      <div className="w-full max-w-5xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">Collab Space</h1>
        
        {/* Controls */}
        <div className="flex justify-center space-x-4 mb-8">
          <button onClick={startCamera} disabled={isMediaActive} className={`px-4 py-2 rounded-lg font-semibold text-white shadow-md ${isMediaActive ? 'bg-gray-400' : 'bg-gray-800'}`}>1. Camera</button>
          <button onClick={loadMediasoupDevice} disabled={!isMediaActive || deviceLoaded} className={`px-4 py-2 rounded-lg font-semibold text-white shadow-md ${!isMediaActive || deviceLoaded ? 'bg-gray-400' : 'bg-blue-600'}`}>2. Connect & Build</button>
          <button onClick={produceVideo} disabled={!deviceLoaded || isProducing} className={`px-4 py-2 rounded-lg font-semibold text-white shadow-md ${!deviceLoaded || isProducing ? 'bg-gray-400' : 'bg-green-600'}`}>3. Join Meeting (Go Live)</button>
        </div>

        {/* Video Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Local Video */}
          <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden shadow-lg border-2 border-green-500">
            <span className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs z-10">You</span>
            <video ref={localVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          </div>

          {/* Remote Videos */}
          {remoteStreams.map((remote) => (
            <div key={remote.id} className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden shadow-lg border border-gray-200">
              <span className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-xs z-10">Peer ({remote.id.substring(0,4)})</span>
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