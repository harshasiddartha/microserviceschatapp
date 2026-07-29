'use strict';

const { logger, config, rabbit, redis } = require('@chat/shared');
const { NotificationHandler } = require('./handler');
const { createApp } = require('./app');

async function main() {
  const log = logger.createLogger('notification');
  const cfg = config.loadConfig();

  const redisClient = redis.makeClient(cfg.redisUrl, { logger: log });
  const handler = new NotificationHandler({
    logger: log,
    redisClient,
    presenceModule: redis,
  });

  const { app } = createApp({ cfg, logger: log, handler });

  const server = app.listen(cfg.ports.notif, () => {
    log.info({ port: cfg.ports.notif }, 'notification service listening');
  });

  const consumer = await rabbit.makeConsumer(cfg.rabbitUrl, {
    queue: 'notifications.q',
    prefetch: cfg.prefetch,
    logger: log,
    handler: (msg) => handler.handle(msg),
  });

  log.info({ prefetch: cfg.prefetch }, 'consuming notifications.q');

  async function shutdown(signal) {
    log.info({ signal }, 'shutting down');
    // Stop consuming FIRST so in-flight messages finish and get ACKed before the connection closes.
    await consumer.close();
    server.close(async () => {
      await redisClient.quit();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('notification service failed to start:', err);
  process.exit(1);
});
