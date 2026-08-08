const { getWorker } = require('../mediasoup/worker');
const { MEDIA_CODECS } = require('../config');

/**
 * In-memory room registry.
 *
 * roomId -> {
 *   router,
 *   peers:     { socketId: { sendTransport, recvTransport } },
 *   producers: [{ id, socketId, kind }],
 *   whiteboard: { shapes: Map<id, shape>, version: number },
 * }
 *
 * Every feature that needs per-room state adds its slice in `createRoomState`
 * below, so there is exactly one place to look for "what does a room hold?".
 */
const rooms = new Map();

function createRoomState(router) {
  return {
    router,
    peers: {},
    producers: [],

    // ── per-feature state ──────────────────────────────────────────────────
    whiteboard: {
      shapes: new Map(), // id -> shape object
      version: 0,        // monotonically increasing version counter
    },
  };
}

async function getOrCreateRoom(roomId) {
  if (rooms.has(roomId)) return rooms.get(roomId);
  const router = await getWorker().createRouter({ mediaCodecs: MEDIA_CODECS });
  const room = createRoomState(router);
  rooms.set(roomId, room);
  console.log(`🏠 Room created: ${roomId}`);
  return room;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

/** Room the socket joined, or undefined if it never joined one. */
function getRoomForSocket(socket) {
  return socket.roomId ? rooms.get(socket.roomId) : undefined;
}

function addPeer(room, socketId) {
  room.peers[socketId] = { sendTransport: null, recvTransport: null };
}

function removePeer(room, socketId) {
  delete room.peers[socketId];
  room.producers = room.producers.filter((p) => p.socketId !== socketId);
}

/** Tears down the mediasoup router and drops the room once the last peer leaves. */
function closeRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (!room) return false;
  if (Object.keys(room.peers).length > 0) return false;
  room.router.close();
  rooms.delete(roomId);
  console.log(`🗑️  Room deleted (empty): ${roomId}`);
  return true;
}

module.exports = {
  rooms,
  getOrCreateRoom,
  getRoom,
  getRoomForSocket,
  addPeer,
  removePeer,
  closeRoomIfEmpty,
};
