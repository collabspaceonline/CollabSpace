const { getRoomForSocket } = require('../../rooms/roomStore');

/**
 * Authoritative whiteboard state (`room.whiteboard`) — shape CRUD plus the
 * version counter used for optimistic-concurrency reconciliation.
 */
function registerWhiteboardHandlers(io, socket) {
  /**
   * wb:getState — called when a user opens the whiteboard.
   * Returns the current list of shapes and the room version.
   */
  socket.on('wb:getState', (callback) => {
    const room = getRoomForSocket(socket);
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
    const room = getRoomForSocket(socket);
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
    const room = getRoomForSocket(socket);
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
    const room = getRoomForSocket(socket);
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
    const room = getRoomForSocket(socket);
    if (!room) return;

    room.whiteboard.shapes.clear();
    room.whiteboard.version += 1;

    io.to(socket.roomId).emit('wb:boardCleared', { version: room.whiteboard.version });
  });
}

module.exports = { registerWhiteboardHandlers };
