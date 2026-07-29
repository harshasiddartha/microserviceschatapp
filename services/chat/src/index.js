'use strict';

const { logger, config, rabbit, redis } = require('@chat/shared');
const { createApp } = require('./app');

async function main() {
  const log = logger.createLogger('chat');
  const cfg = config.loadConfig();

  const publisher = await rabbit.makePublisher(cfg.rabbitUrl, { logger: log });
  const redisClient = redis.makeClient(cfg.redisUrl, { logger: log });

  const { app } = createApp({ cfg, logger: log, publisher, redisClient });

  const server = app.listen(cfg.ports.chat, () => {
    log.info({ port: cfg.ports.chat }, 'chat service listening');
  });

  function shutdown(signal) {
    log.info({ signal }, 'shutting down');
    server.close(async () => {
      await publisher.close();
      await redisClient.quit();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('chat service failed to start:', err);
  process.exit(1);
});
