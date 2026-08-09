# SFU server architecture

The server used to be one `server.js`. It is now split by responsibility so a new
feature means a new file, not another 80 lines in the middle of a 300-line handler.

## Layout

```
src/
  server.js                    entry point — create http server + io, wire, listen
  app.js                       the Express app (HTTP routes live here)
  config.js                    env vars + mediasoup/socket.io tuning constants
  mediasoup/
    worker.js                  creates and hands out the single mediasoup worker
    transport.js               createWebRtcTransport(router)
  rooms/
    roomStore.js               the `rooms` Map + all room lifecycle helpers
  socket/
    index.js                   io.on('connection') — registers every feature module
    handlers/
      media.js                 joinRoom, transports, produce/consume, peer teardown
      whiteboard.js            wb:* shape CRUD (authoritative state + versions)
      cursors.js               wb:cursorMove / cursorLeave / lockShape / unlockShape
      reactions.js             reaction, raiseHand
      screenShare.js           screen:* — who is presenting, and on what surface
```

## Producers carry a `source`

Every producer is tagged `appData.source` — `camera`, `mic`, `screen` or
`screenAudio` (`MEDIA_SOURCES` in `config.js`). Without it a screen share is
indistinguishable from a webcam, since both arrive as `kind: 'video'`. The label
is stored on the producer record and repeated in `new-producer` and
`getProducers` so clients can route each track.

`room.producers` records hold the live mediasoup `Producer` as `handle`, so
**never send a record to a client** — map it through `publicProducer` first.
`closeProducer` ends one track without ending the call, and only ever closes a
producer belonging to the socket that asked.

## The rules

**1. One feature = one file in `socket/handlers/`.**
Each file exports a single `registerXHandlers(io, socket)` that attaches all of
that feature's `socket.on(...)` listeners. No file reaches into another handler.

**2. Shared state lives on the room, created in `roomStore.createRoomState`.**
If your feature needs per-room memory (like `room.whiteboard`), add a slice
there. That function is the complete answer to "what does a room hold?".

**3. Everything reads the room through `roomStore`, never `rooms.get(...)` inline.**
Use `getRoomForSocket(socket)` — it returns `undefined` when the socket never
joined, which is the guard every handler needs anyway.

**4. Each feature cleans up after itself in its own `disconnect` listener.**
Socket.IO allows many `disconnect` listeners and calls them in registration
order. `registerMediaHandlers` is registered **last** in `socket/index.js`
because it removes the peer and may close the room — other features need to
broadcast "this peer is leaving" before that happens.

**5. No magic numbers or `process.env` outside `config.js`.**

**6. `server.js` stays boring.** If you are editing it for anything other than
wiring a new top-level concern (a database client, a cron, a second transport),
the change probably belongs in a module.

## Adding a new feature — worked example: chat

1. **State** (only if you need history). In `src/rooms/roomStore.js`, inside
   `createRoomState`, add to the per-feature section:

   ```js
   chat: { messages: [] },
   ```

2. **Handler.** Create `src/socket/handlers/chat.js`:

   ```js
   const { getRoomForSocket } = require('../../rooms/roomStore');

   function registerChatHandlers(io, socket) {
     socket.on('chat:getHistory', (callback) => {
       const room = getRoomForSocket(socket);
       callback(room ? room.chat.messages : []);
     });

     socket.on('chat:send', ({ text }) => {
       const room = getRoomForSocket(socket);
       if (!room || !text) return;
       const message = { id: crypto.randomUUID(), socketId: socket.id, text, at: Date.now() };
       room.chat.messages.push(message);
       io.to(socket.roomId).emit('chat:message', message);
     });
   }

   module.exports = { registerChatHandlers };
   ```

3. **Register it.** In `src/socket/index.js`, import it and add it to
   `featureHandlers` — **above** `registerMediaHandlers`:

   ```js
   const featureHandlers = [
     registerCursorHandlers,
     registerReactionHandlers,
     registerWhiteboardHandlers,
     registerScreenShareHandlers,
     registerChatHandlers,
     registerMediaHandlers, // keep last — tears down the peer/room
   ];
   ```

That's the whole loop. Nothing else in the server changes.

### Conventions worth keeping

- **Namespace your events** (`chat:`, `wb:`) so the client-side listener map
  stays readable and events never collide.
- **`socket.to(room)` vs `io.to(room)`** — `socket.to` excludes the sender (use
  it when the sender already applied the change optimistically); `io.to`
  includes them (use it when the server's version is authoritative).
- **Ack callbacks for reads, broadcasts for writes.** `wb:getState` and
  `getProducers` take a callback; mutations broadcast an event.
- **Validate the payload and bail early.** Every handler starts with a guard;
  a malformed message from one client must never throw in the room loop.

## Running it

```bash
npm start       # node src/server.js
npm run dev     # node --watch src/server.js
```

Env: `PORT` (default 4000), `ANNOUNCED_IP` (default 127.0.0.1 — set this to the
machine's public IP in any non-local deployment).

## When this outgrows itself

Two signals to watch for:

- **A handler file passes ~200 lines** → split it by sub-feature
  (`whiteboard/shapes.js`, `whiteboard/images.js`) behind one `register` export.
- **State survives a restart / multiple server instances** → `roomStore` is the
  single seam to swap for Redis or Postgres. Everything else already goes
  through it, so no handler needs to change.
