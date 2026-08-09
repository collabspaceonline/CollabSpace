const { getWorker } = require('../mediasoup/worker');
const { MEDIA_CODECS, DEFAULT_SOURCE_BY_KIND, KNOWN_SOURCES } = require('../config');

/**
 * In-memory room registry.
 *
 * roomId -> {
 *   router,
 *   peers:     { socketId: { sendTransport, recvTransport } },
 *   producers: [{ id, socketId, kind, source, handle }],
 *   whiteboard: { shapes: Map<id, shape>, version: number },
 *   screenShare: { presenters: Map<socketId, presentation> },
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
    screenShare: {
      // socketId -> { socketId, surface, startedAt }. A Map because more than
      // one peer may present at once, and insertion order gives us "newest".
      presenters: new Map(),
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
  for (const record of room.producers) {
    if (record.socketId === socketId) closeHandle(record);
  }
  room.producers = room.producers.filter((p) => p.socketId !== socketId);
  room.screenShare.presenters.delete(socketId);
}

// ── producers ────────────────────────────────────────────────────────────────

/** Falls back to the kind's default so an unlabelled producer is still routable. */
function normalizeSource(source, kind) {
  return KNOWN_SOURCES.includes(source) ? source : DEFAULT_SOURCE_BY_KIND[kind];
}

/**
 * Records a live producer. `handle` is the mediasoup Producer itself, which is
 * why nothing may send a record over the wire — use `publicProducer` for that.
 */
function addProducer(room, socketId, producer) {
  const record = {
    id: producer.id,
    socketId,
    kind: producer.kind,
    source: normalizeSource(producer.appData?.source, producer.kind),
    handle: producer,
  };
  room.producers.push(record);
  return record;
}

/** The subset of a producer record that is safe to hand to a client. */
function publicProducer({ id, socketId, kind, source }) {
  return { id, socketId, kind, source };
}

function closeHandle(record) {
  if (!record.handle.closed) record.handle.close();
}

/**
 * Closes one of `socketId`'s own producers. Returns false when the producer is
 * unknown or belongs to someone else, so a peer can never close another's feed.
 */
function closeProducer(room, socketId, producerId) {
  const index = room.producers.findIndex((p) => p.id === producerId && p.socketId === socketId);
  if (index === -1) return false;
  closeHandle(room.producers[index]);
  room.producers.splice(index, 1);
  return true;
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
  addProducer,
  publicProducer,
  closeProducer,
  closeRoomIfEmpty,
};
