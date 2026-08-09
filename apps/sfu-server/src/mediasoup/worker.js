const mediasoup = require('mediasoup');
const { WORKER_SETTINGS } = require('../config');

let worker = null;

async function createWorker() {
  worker = await mediasoup.createWorker(WORKER_SETTINGS);
  worker.on('died', () => {
    console.error('💀 Mediasoup worker died — exiting so the process can restart');
    process.exit(1);
  });
  console.log(`✅ Mediasoup Worker running!`);
  return worker;
}

function getWorker() {
  if (!worker) throw new Error('Mediasoup worker has not been created yet');
  return worker;
}

module.exports = { createWorker, getWorker };
