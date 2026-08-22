const http = require('http');
const { Server } = require('socket.io');

const app = require('./app');
const { PORT, SOCKET_IO_OPTIONS } = require('./config');
const { createWorker } = require('./mediasoup/worker');
const { registerSocketHandlers } = require('./socket');

const server = http.createServer(app);
const io = new Server(server, SOCKET_IO_OPTIONS);

registerSocketHandlers(io);

// Setup y-websocket server on the same HTTP server
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', setupWSConnection);

server.on('upgrade', (request, socket, head) => {
  // You may want to restrict the path to /yjs
  if (request.url.startsWith('/yjs')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

// The worker must exist before we accept connections — the first `joinRoom`
// needs it to create a router.
async function start() {
  await createWorker();
  server.listen(PORT, () => {
    console.log(`🚀 SFU Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start SFU server:', err);
  process.exit(1);
});
