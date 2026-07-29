'use strict';

const { logger, config } = require('@chat/shared');
const { createApp } = require('./app');

const log = logger.createLogger('auth');
const cfg = config.loadConfig();
const { app } = createApp({ cfg, logger: log });

const server = app.listen(cfg.ports.auth, () => {
  log.info({ port: cfg.ports.auth }, 'auth service listening');
});

function shutdown(signal) {
  log.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
