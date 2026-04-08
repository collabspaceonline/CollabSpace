const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const cors = require('cors')
const app = express();
app.use(cors({ origin: '*' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

let worker;

// roomId -> { router, peers: { socketId: { sendTransport, recvTransport } }, producers: [], whiteboard: { shapes: Map<id, shape>, version: number } }
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
  const room = {
    router,
    peers: {},
    producers: [],
    whiteboard: {
      shapes: new Map(), // id -> shape object
      version: 0,        // monotonically increasing version counter
    }
  };
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

  // 0. Join a room
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

  // 3. PRODUCE
  socket.on('transport-produce', async ({ kind, rtpParameters }, callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) return callback({ error: 'Not in a room' });
    const producer = await room.peers[socket.id].sendTransport.produce({ kind, rtpParameters });
    room.producers.push({ id: producer.id, socketId: socket.id, kind: producer.kind });

    if (producer.kind === 'video') {
      io.to(socket.roomId).emit('new-producer', { producerId: producer.id, socketId: socket.id, kind: producer.kind });
    } else {
      socket.to(socket.roomId).emit('new-producer', { producerId: producer.id, socketId: socket.id, kind: producer.kind });
    }
    callback({ id: producer.id });
  });

  // 4. CONSUME
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

  socket.on('getProducers', (callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) return callback([]);
    callback(room.producers.filter(p => !(p.socketId === socket.id && p.kind === 'audio')));
  });

  // ─── WHITEBOARD EVENTS ─────────────────────────────────────────────────────

  /**
   * wb:getState — called when a user opens the whiteboard.
   * Returns the current list of shapes and the room version.
   */
  socket.on('wb:getState', (callback) => {
    const room = rooms.get(socket.roomId);
    if (!room) return callback({ shapes: [], version: 0 });
    callback({
      shapes: Array.from(room.whiteboard.shapes.values()),
      version: room.whiteboard.version,
    });
  });

  /**
   * wb:createShape — a client added a new shape.
   * Payload: { shape: { id, type, x, y, width?, height?, radius?, color, strokeColor, strokeWidth, text?, rotation, createdAt } }
   */
  socket.on('wb:createShape', ({ shape }) => {
    const room = rooms.get(socket.roomId);
    if (!room || !shape?.id) return;

    // Prevent duplicate inserts
    if (room.whiteboard.shapes.has(shape.id)) return;

    room.whiteboard.version += 1;
    const stamped = { ...shape, version: room.whiteboard.version, updatedAt: Date.now() };
    room.whiteboard.shapes.set(shape.id, stamped);

    // Broadcast to everyone ELSE (creator already has it)
    socket.to(socket.roomId).emit('wb:shapeCreated', { shape: stamped, version: room.whiteboard.version });
  });

  /**
   * wb:updateShape — a client moved/resized/edited a shape.
   * Payload: { id, changes: { x?, y?, width?, height?, radius?, color?, text?, rotation? }, clientVersion }
   * clientVersion is used for optimistic-concurrency: we only apply if clientVersion >= shape.version
   */
  socket.on('wb:updateShape', ({ id, changes, clientVersion }) => {
    const room = rooms.get(socket.roomId);
    if (!room || !id) return;

    const existing = room.whiteboard.shapes.get(id);
    if (!existing) return;

    // Reject stale updates (last-write-wins with version gate)
    if (clientVersion !== undefined && clientVersion < existing.version) {
      // Send back the authoritative shape so the client can reconcile
      socket.emit('wb:shapeConflict', { shape: existing });
      return;
    }

    room.whiteboard.version += 1;
    const updated = {
      ...existing,
      ...changes,
      id, // id is immutable
      version: room.whiteboard.version,
      updatedAt: Date.now(),
    };
    room.whiteboard.shapes.set(id, updated);

    // Broadcast update to ALL clients in room (including sender, for ACK/reconcile)
    io.to(socket.roomId).emit('wb:shapeUpdated', { shape: updated, version: room.whiteboard.version });
  });

  /**
   * wb:deleteShape — a client deleted a shape.
   * Payload: { id }
   */
  socket.on('wb:deleteShape', ({ id }) => {
    const room = rooms.get(socket.roomId);
    if (!room || !id) return;
    if (!room.whiteboard.shapes.has(id)) return;

    room.whiteboard.version += 1;
    room.whiteboard.shapes.delete(id);

    io.to(socket.roomId).emit('wb:shapeDeleted', { id, version: room.whiteboard.version });
  });

  /**
   * wb:clearBoard — clear the entire whiteboard.
   */
  socket.on('wb:clearBoard', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    room.whiteboard.shapes.clear();
    room.whiteboard.version += 1;

    io.to(socket.roomId).emit('wb:boardCleared', { version: room.whiteboard.version });
  });

  // ─── LIVE CURSORS ───────────────────────────────────────────────────────────

  socket.on('wb:cursorMove', ({ x, y }) => {
    if (!socket.roomId) return;
    socket.to(socket.roomId).emit('wb:cursorMove', { socketId: socket.id, x, y });
  });

  socket.on('wb:cursorLeave', () => {
    if (!socket.roomId) return;
    socket.to(socket.roomId).emit('wb:cursorLeave', { socketId: socket.id });
  });

  /**
   * wb:lockShape — temporary lock to prevent users from typing over each other
   */
  socket.on('wb:lockShape', ({ id, userId }) => {
    if (!socket.roomId) return;
    // Broadcast directly to others without saving to the Map
    socket.to(socket.roomId).emit('wb:shapeLocked', { id, userId });
  });

  /**
   * wb:unlockShape — release the temporary lock
   */
  socket.on('wb:unlockShape', ({ id }) => {
    if (!socket.roomId) return;
    socket.to(socket.roomId).emit('wb:shapeUnlocked', { id });
  });

  // ─── DISCONNECT ────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    socket.to(roomId).emit('wb:cursorLeave', { socketId: socket.id });
    delete room.peers[socket.id];
    room.producers = room.producers.filter(p => p.socketId !== socket.id);
    socket.to(roomId).emit('peer-disconnected', { socketId: socket.id });
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