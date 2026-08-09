const { SHARE_SURFACES, DEFAULT_SHARE_SURFACE } = require('../../config');
const { getRoomForSocket } = require('../../rooms/roomStore');

/**
 * Who is presenting, and what kind of surface they picked.
 *
 * This is *only* the announcement. The pixels travel as an ordinary mediasoup
 * producer tagged `source: 'screen'` (see `media.js`); this handler exists so
 * peers know a presentation started — and what to call it — without having to
 * infer it from producer traffic, and so the state survives a late joiner.
 *
 * Several peers may present at once, exactly like Google Meet. The client
 * decides which one fills its stage.
 */
function registerScreenShareHandlers(io, socket) {
  socket.on('screen:start', ({ surface } = {}, callback) => {
    const room = getRoomForSocket(socket);
    if (!room) return callback?.({ error: 'Not in a room' });

    const presentation = {
      socketId: socket.id,
      surface: SHARE_SURFACES.includes(surface) ? surface : DEFAULT_SHARE_SURFACE,
      startedAt: Date.now(),
    };
    room.screenShare.presenters.set(socket.id, presentation);
    // io.to, not socket.to: the presenter renders the same "you are presenting"
    // banner from this event, so everyone works off one authoritative record.
    io.to(socket.roomId).emit('screen:started', presentation);
    callback?.({ presentation });
  });

  socket.on('screen:stop', (callback) => {
    stopPresenting();
    callback?.({ stopped: true });
  });

  socket.on('screen:getState', (callback) => {
    const room = getRoomForSocket(socket);
    callback?.(room ? [...room.screenShare.presenters.values()] : []);
  });

  // Registered above the media handler, so the room still exists here.
  socket.on('disconnect', stopPresenting);

  /** Idempotent — only broadcasts if this socket really was presenting. */
  function stopPresenting() {
    const room = getRoomForSocket(socket);
    if (!room || !room.screenShare.presenters.delete(socket.id)) return;
    io.to(socket.roomId).emit('screen:stopped', { socketId: socket.id });
  }
}

module.exports = { registerScreenShareHandlers };
