const { createWebRtcTransport } = require('../../mediasoup/transport');
const {
  getOrCreateRoom,
  getRoomForSocket,
  addPeer,
  removePeer,
  closeRoomIfEmpty,
} = require('../../rooms/roomStore');

/**
 * Mediasoup signalling: joining a room, building transports, producing and
 * consuming tracks. Also owns peer/producer cleanup on disconnect.
 */
function registerMediaHandlers(io, socket) {
  // 0. Join a room
  socket.on('joinRoom', async ({ roomId }, callback) => {
    try {
      const room = await getOrCreateRoom(roomId);
      socket.roomId = roomId;
      addPeer(room, socket.id);
      socket.join(roomId);
      console.log(`👤 ${socket.id} joined room: ${roomId}`);
      callback({ rtpCapabilities: room.router.rtpCapabilities });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // 1. Create Pipeline
  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    try {
      const room = getRoomForSocket(socket);
      if (!room) return callback({ params: { error: 'Not in a room' } });
      const transport = await createWebRtcTransport(room.router);
      if (sender) room.peers[socket.id].sendTransport = transport;
      else room.peers[socket.id].recvTransport = transport;
      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    } catch (err) {
      callback({ params: { error: err.message } });
    }
  });

  // 2. Connect Pipeline
  socket.on('transport-connect', async ({ dtlsParameters, isSender }) => {
    const room = getRoomForSocket(socket);
    if (!room) return;
    const transport = isSender
      ? room.peers[socket.id].sendTransport
      : room.peers[socket.id].recvTransport;
    await transport.connect({ dtlsParameters });
  });

  // 3. PRODUCE
  socket.on('transport-produce', async ({ kind, rtpParameters }, callback) => {
    const room = getRoomForSocket(socket);
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
      const room = getRoomForSocket(socket);
      if (!room) return callback({ error: 'Not in a room' });
      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        return callback({ error: 'Cannot consume' });
      }
      const consumer = await room.peers[socket.id].recvTransport.consume({
        producerId, rtpCapabilities, paused: false,
      });
      callback({
        params: {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        },
      });
    } catch (error) {
      callback({ error: error.message });
    }
  });

  socket.on('getProducers', (callback) => {
    const room = getRoomForSocket(socket);
    if (!room) return callback([]);
    callback(room.producers.filter((p) => !(p.socketId === socket.id && p.kind === 'audio')));
  });

  // Registered last in socket/index.js, so feature handlers get to broadcast
  // their "peer is leaving" messages before the room is torn down.
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const room = getRoomForSocket(socket);
    if (!room) return;
    removePeer(room, socket.id);
    socket.to(roomId).emit('peer-disconnected', { socketId: socket.id });
    closeRoomIfEmpty(roomId);
  });
}

module.exports = { registerMediaHandlers };
