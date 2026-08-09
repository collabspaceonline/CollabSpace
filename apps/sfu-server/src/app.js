const express = require('express');
const cors = require('cors');
const { CORS_OPTIONS } = require('./config');

/**
 * The plain Express app. HTTP routes (health checks, REST endpoints) go here
 * or in a `routes/` folder mounted from here — socket logic lives in `socket/`.
 */
const app = express();
app.use(cors(CORS_OPTIONS));

module.exports = app;
