const http = require('http');
const { Server } = require('socket.io');

const app = require('./app');
const { PORT, SOCKET_IO_OPTIONS } = require('./config');
const { createWorker } = require('./mediasoup/worker');
const { registerSocketHandlers } = require('./socket');

const server = http.createServer(app);
const io = new Server(server, SOCKET_IO_OPTIONS);

registerSocketHandlers(io);

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
