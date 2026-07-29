'use strict';

const pino = require('pino');

function createLogger(service) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

module.exports = { createLogger };
