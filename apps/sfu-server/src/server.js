const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

let worker;
let router; 
// We need to keep track of everyone's pipelines and video tracks!
let peers = {}; 
let producers = []; 

const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } }
];

async function createWorker() {
  worker = await mediasoup.createWorker({ logLevel: 'warn', rtcMinPort: 40000, rtcMaxPort: 49999 });
  router = await worker.createRouter({ mediaCodecs });
  console.log(`✅ Mediasoup Worker & Router running!`);
  return worker;
}

async function createWebRtcTransport(router) {
  return new Promise(async (resolve, reject) => {
    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1' }],
        enableUdp: true, enableTcp: true, preferUdp: true,
      });
      transport.on('dtlsstatechange', dtlsState => { if (dtlsState === 'closed') transport.close(); });
      resolve(transport);
    } catch (error) { reject(error); }
  });
}

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  peers[socket.id] = { sendTransport: null, recvTransport: null };

  // 1. Handshake
  socket.on('getRouterRtpCapabilities', (callback) => {
    callback(router.rtpCapabilities);
  });

  // 2. Create Pipeline
  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    try {
      const transport = await createWebRtcTransport(router);
      if (sender) peers[socket.id].sendTransport = transport;
      else peers[socket.id].recvTransport = transport;

      callback({ params: { id: transport.id, iceParameters: transport.iceParameters, iceCandidates: transport.iceCandidates, dtlsParameters: transport.dtlsParameters } });
    } catch (err) { callback({ params: { error: err.message } }); }
  });

  // 3. Connect Pipeline
  socket.on('transport-connect', async ({ dtlsParameters, isSender }) => {
    const transport = isSender ? peers[socket.id].sendTransport : peers[socket.id].recvTransport;
    await transport.connect({ dtlsParameters });
  });

  // 4. PRODUCE (Receive video from user)
  socket.on('transport-produce', async ({ kind, rtpParameters }, callback) => {
    const producer = await peers[socket.id].sendTransport.produce({ kind, rtpParameters });
    producers.push({ id: producer.id, socketId: socket.id, kind: producer.kind });

    // Tell everyone (including sender for their own video) that a new track is available
    if (producer.kind === 'video') {
      io.emit('new-producer', { producerId: producer.id, socketId: socket.id, kind: producer.kind });
    } else {
      socket.broadcast.emit('new-producer', { producerId: producer.id, socketId: socket.id, kind: producer.kind });
    }
    callback({ id: producer.id });
  });

  // 5. CONSUME (Send video to user)
  socket.on('consume', async ({ rtpCapabilities, producerId }, callback) => {
    try {
      if (!router.canConsume({ producerId, rtpCapabilities })) {
        return callback({ error: 'Cannot consume' });
      }
      const consumer = await peers[socket.id].recvTransport.consume({
        producerId, rtpCapabilities, paused: false
      });
      callback({ params: { id: consumer.id, producerId: consumer.producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters } });
    } catch (error) { callback({ error: error.message }); }
  });

  // Let new users know about existing videos
  socket.on('getProducers', (callback) => {
    callback(producers.filter(p => !(p.socketId === socket.id && p.kind === 'audio')));
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    delete peers[socket.id];
    producers = producers.filter(p => p.socketId !== socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, async () => {
  console.log(`🚀 SFU Server running on port ${PORT}`);
  await createWorker();
});