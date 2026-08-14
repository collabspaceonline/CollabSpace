const { createWebRtcTransport } = require('../../mediasoup/transport');
const {
  createRoom,
  getRoom,
  getRoomForSocket,
  addPeer,
  removePeer,
  addProducer,
  publicProducer,
  closeProducer,
  closeRoomIfEmpty,
} = require('../../rooms/roomStore');

/**
 * Mediasoup signalling: joining a room, building transports, producing and
 * consuming tracks. Also owns peer/producer cleanup on disconnect.
 */
function registerMediaHandlers(io, socket) {
  socket.on('createRoom', async ({ roomId }, callback) => {
    try {
      await createRoom(roomId);
      callback({ success: true, message: 'Room created successfully' });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // UPDATED: 0b. Join an existing room (Participants will call this)
  socket.on('joinRoom', async ({ roomId }, callback) => {
    try {
      // Fetch the room synchronously WITHOUT creating it
      const room = getRoom(roomId);
      
      // Reject if the room doesn't exist
      if (!room) {
        return callback({ error: 'Room does not exist. Please check the room number.' });
      }

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
  // `appData.source` says what the track *is* (camera / mic / screen /
  // screenAudio). Without it a screen share is indistinguishable from a webcam,
  // since both arrive as kind 'video'.
  socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
    const room = getRoomForSocket(socket);
    if (!room) return callback({ error: 'Not in a room' });
    const producer = await room.peers[socket.id].sendTransport.produce({
      kind,
      rtpParameters,
      appData: { source: appData?.source },
    });
    const record = addProducer(room, socket.id, producer);

    // Drop the record if mediasoup tears the producer down under us (transport
    // closed, router closed) so `getProducers` never hands out a dead id.
    producer.on('transportclose', () => {
      closeProducer(room, socket.id, producer.id);
    });

    const announcement = { producerId: record.id, socketId: socket.id, kind: record.kind, source: record.source };
    if (producer.kind === 'video') {
      io.to(socket.roomId).emit('new-producer', announcement);
    } else {
      socket.to(socket.roomId).emit('new-producer', announcement);
    }
    callback({ id: producer.id });
  });

  // 3b. STOP PRODUCING one track without leaving the call — how a screen share
  // ends. Peers drop the matching consumer when they see `producer-closed`.
  socket.on('closeProducer', ({ producerId }, callback) => {
    const room = getRoomForSocket(socket);
    if (!room) return callback?.({ closed: false });
    const closed = closeProducer(room, socket.id, producerId);
    if (closed) {
      io.to(socket.roomId).emit('producer-closed', { producerId, socketId: socket.id });
    }
    callback?.({ closed });
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

  // Never lists the caller's own producers: it already has those tracks locally,
  // and consuming your own mic or screen back is at best wasted bandwidth.
  socket.on('getProducers', (callback) => {
    const room = getRoomForSocket(socket);
    if (!room) return callback([]);
    callback(room.producers.filter((p) => p.socketId !== socket.id).map(publicProducer));
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
