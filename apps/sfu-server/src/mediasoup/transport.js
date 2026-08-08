const { WEBRTC_TRANSPORT_OPTIONS } = require('../config');

async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport(WEBRTC_TRANSPORT_OPTIONS);
  transport.on('dtlsstatechange', (dtlsState) => {
    if (dtlsState === 'closed') transport.close();
  });
  return transport;
}

module.exports = { createWebRtcTransport };
