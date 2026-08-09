/**
 * Live cursors and the temporary shape locks that stop two people from typing
 * into the same text shape. Pure relay — nothing is stored on the room.
 */
function registerCursorHandlers(io, socket) {
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

  socket.on('disconnect', () => {
    if (!socket.roomId) return;
    socket.to(socket.roomId).emit('wb:cursorLeave', { socketId: socket.id });
  });
}

module.exports = { registerCursorHandlers };
