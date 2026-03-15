const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

let worker;

// roomId -> { router, peers: { socketId: { sendTransport, recvTransport } }, producers: [] }
const rooms = new Map();

const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } }
];

async function createWorker() {
  worker = await mediasoup.createWorker({ logLevel: 'warn', rtcMinPort: 40000, rtcMaxPort: 49999 });
  console.log(`✅ Mediasoup Worker running!`);
  return worker;
}

async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const router = await worker.createRouter({ mediaCodecs });
  const room = { router, peers: {}, producers: [] };
  rooms.set(roomId, room);
  console.log(`🏠 Room created: ${roomId}`);
  return room;
}

async function createWebRtcTransport(router) {
  return new Promise(async (resolve, reject) => {
    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1' }],
        enableUdp: true, enableTcp: true, preferUdp: true,
      });
      transport.on('dtlsstatechange', dtlsState => { if (dtlsState === 'closed') transport.close(); });
      resolve(transport);
    } catch (error) { reject(error); }
  });
}

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // 0. Join a room — returns router RTP capabilities for the room
  socket.on('joinRoom', async ({ roomId }, callback) => {
    try {
      const room = await getOrCreateRoom(roomId);
      socket.roomId = roomId;
      room.peers[socket.id] = { sendTransport: null, recvTransport: null };
      socket.join(roomId);
      console.log(`👤 ${socket.id} joined room: ${roomId}`);
      callback({ rtpCapabilities: room.router.rtpCapabilities });
    } catch (err) { callback({ error: err.message }); }
  });

  // 1. Create Pipeline
  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    try {
      const room = rooms.get(socket.roomId);
      if (!room) return callback({ params: { error: 'Not in a room' } });
      const transport = await createWebRtcTransport(room.router);
      if (sender) room.peers[socket.id].sendTransport = transport;
      else room.peers[socket.id].recvTransport = transport;
      callback({ params: { id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters } });
    } catch (err) { callback({ params: { error: err.message } }); }
  });

  // 2. Connect Pipeline
  socket.on('transport-connect', async ({ dtlsParameters, isSender }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const transport = isSender ? room.peers[socket.id].sendTransport : room.peers[socket.id].recvTransport;
    await transport.connect({ dtlsParameters });
  });

  // 3. PRODUCE (Receive track from user)
  socket.on('transport-produce', async ({ kind, rtpParameters }, callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) return callback({ error: 'Not in a room' });
    const producer = await room.peers[socket.id].sendTransport.produce({ kind, rtpParameters });
    room.producers.push({ id: producer.id, socketId: socket.id, kind: producer.kind });

    // Notify everyone else in the room about the new track
    if (producer.kind === 'video') {
      io.to(socket.roomId).emit('new-producer', { producerId: producer.id, socketId: socket.id, kind: producer.kind });
    } else {
      socket.to(socket.roomId).emit('new-producer', { producerId: producer.id, socketId: socket.id, kind: producer.kind });
    }
    callback({ id: producer.id });
  });

  // 4. CONSUME (Send track to user)
  socket.on('consume', async ({ rtpCapabilities, producerId }, callback) => {
    try {
      const room = rooms.get(socket.roomId);
      if (!room) return callback({ error: 'Not in a room' });
      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        return callback({ error: 'Cannot consume' });
      }
      const consumer = await room.peers[socket.id].recvTransport.consume({
        producerId, rtpCapabilities, paused: false
      });
      callback({ params: { id: consumer.id, producerId: consumer.producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters } });
    } catch (error) { callback({ error: error.message }); }
  });

  // Let new users know about existing producers in the room
  socket.on('getProducers', (callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) return callback([]);
    callback(room.producers.filter(p => !(p.socketId === socket.id && p.kind === 'audio')));
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    delete room.peers[socket.id];
    room.producers = room.producers.filter(p => p.socketId !== socket.id);
    // Notify remaining peers that this peer left
    socket.to(roomId).emit('peer-disconnected', { socketId: socket.id });
    // Clean up empty rooms
    if (Object.keys(room.peers).length === 0) {
      room.router.close();
      rooms.delete(roomId);
      console.log(`🗑️  Room deleted (empty): ${roomId}`);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, async () => {
  console.log(`🚀 SFU Server running on port ${PORT}`);
  await createWorker();
});
