/**
 * Single source of truth for env-driven settings and mediasoup tuning.
 * Nothing here should require another app module — config is a leaf.
 */

const PORT = process.env.PORT || 4000;
const ANNOUNCED_IP = process.env.ANNOUNCED_IP || '127.0.0.1';

const CORS_OPTIONS = { origin: '*' };

const SOCKET_IO_OPTIONS = {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 10 * 1024 * 1024, // 10 MB — allow image imports on whiteboard
};

const WORKER_SETTINGS = {
  logLevel: 'warn',
  rtcMinPort: 40000,
  rtcMaxPort: 49999,
};

const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
];

const WEBRTC_TRANSPORT_OPTIONS = {
  listenIps: [{ ip: '0.0.0.0', announcedIp: ANNOUNCED_IP }],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
};

module.exports = {
  PORT,
  ANNOUNCED_IP,
  CORS_OPTIONS,
  SOCKET_IO_OPTIONS,
  WORKER_SETTINGS,
  MEDIA_CODECS,
  WEBRTC_TRANSPORT_OPTIONS,
};
