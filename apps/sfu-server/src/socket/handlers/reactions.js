/**
 * Emoji reactions and raise-hand. Both are broadcast to the whole room,
 * including the sender, so every client renders the same thing.
 */
function registerReactionHandlers(io, socket) {
  socket.on('reaction', ({ emoji }) => {
    if (!socket.roomId || !emoji) return;
    io.to(socket.roomId).emit('reaction', { socketId: socket.id, emoji });
  });

  socket.on('raiseHand', ({ raised }) => {
    if (!socket.roomId) return;
    io.to(socket.roomId).emit('raiseHand', { socketId: socket.id, raised: !!raised });
  });

  socket.on('disconnect', () => {
    if (!socket.roomId) return;
    // Drop the hand so it does not stay up for everyone else
    socket.to(socket.roomId).emit('raiseHand', { socketId: socket.id, raised: false });
  });
}

module.exports = { registerReactionHandlers };
