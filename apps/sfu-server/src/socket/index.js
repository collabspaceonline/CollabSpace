const { registerCursorHandlers } = require('./handlers/cursors');
const { registerReactionHandlers } = require('./handlers/reactions');
const { registerWhiteboardHandlers } = require('./handlers/whiteboard');
const { registerScreenShareHandlers } = require('./handlers/screenShare');
const { registerDocumentHandlers } = require('./handlers/document');
const { registerMediaHandlers } = require('./handlers/media');

/**
 * Every feature module is registered here, in one list.
 *
 * Each `register*Handlers(io, socket)` attaches its own `socket.on(...)`
 * listeners — including its own `disconnect` cleanup. Listeners fire in
 * registration order, so `registerMediaHandlers` stays LAST: it removes the
 * peer and may close the room, and the other features want to broadcast
 * "this peer is leaving" before that happens.
 */
const featureHandlers = [
  registerCursorHandlers,
  registerReactionHandlers,
  registerWhiteboardHandlers,
  registerScreenShareHandlers,
  registerDocumentHandlers,
  registerMediaHandlers, // keep last — tears down the peer/room
];

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });

    for (const register of featureHandlers) register(io, socket);
  });
}

module.exports = { registerSocketHandlers };
