'use strict';

const amqp = require('amqplib');

const EXCHANGE = 'chat.events';
const DLX = 'chat.events.dlx';

async function connect(url, { logger, retries = 30, delayMs = 1000 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      const conn = await amqp.connect(url);
      conn.on('error', (err) => logger?.error({ err }, 'rabbit connection error'));
      conn.on('close', () => logger?.warn('rabbit connection closed'));
      return conn;
    } catch (err) {
      attempt += 1;
      if (attempt >= retries) throw err;
      logger?.warn({ attempt, err: err.message }, 'rabbit connect retry');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function assertTopology(channel) {
  await channel.assertExchange(DLX, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

  await channel.assertQueue('notifications.q', {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': DLX,
      'x-dead-letter-routing-key': 'notifications.dead',
    },
  });
  await channel.bindQueue('notifications.q', EXCHANGE, 'message.sent');

  await channel.assertQueue('notifications.dead.q', { durable: true });
  await channel.bindQueue('notifications.dead.q', DLX, 'notifications.dead');
}

async function makePublisher(url, { logger } = {}) {
  const conn = await connect(url, { logger });
  const channel = await conn.createConfirmChannel();
  await assertTopology(channel);

  return {
    async publish(routingKey, message) {
      return new Promise((resolve, reject) => {
        const payload = Buffer.from(JSON.stringify(message));
        const ok = channel.publish(EXCHANGE, routingKey, payload, {
          persistent: true,
          contentType: 'application/json',
          messageId: message.id,
          timestamp: Date.now(),
        }, (err) => (err ? reject(err) : resolve(true)));
        if (!ok) channel.once('drain', () => resolve(true));
      });
    },
    async close() {
      try { await channel.close(); } catch { /* noop */ }
      try { await conn.close(); } catch { /* noop */ }
    },
    channel,
    conn,
  };
}

async function makeConsumer(url, {
  queue = 'notifications.q',
  prefetch = 16,
  handler,
  logger,
} = {}) {
  const conn = await connect(url, { logger });
  const channel = await conn.createChannel();
  await assertTopology(channel);
  await channel.prefetch(prefetch);

  const { consumerTag } = await channel.consume(
    queue,
    async (msg) => {
      if (!msg) return;
      let parsed;
      try {
        parsed = JSON.parse(msg.content.toString('utf8'));
      } catch (err) {
        logger?.error({ err }, 'unparseable message; dead-lettering');
        channel.reject(msg, false);
        return;
      }
      try {
        await handler(parsed, msg);
        channel.ack(msg);
      } catch (err) {
        const attempts = Number(msg.properties.headers?.['x-attempts'] || 0) + 1;
        logger?.warn({ err: err.message, attempts, id: parsed?.id }, 'handler failed');
        if (attempts >= 5) {
          logger?.error({ id: parsed?.id }, 'giving up; dead-lettering');
          channel.reject(msg, false);
        } else {
          // Re-queue with attempts counter (nack requeue keeps it in-flight for another delivery).
          channel.nack(msg, false, true);
        }
      }
    },
    { noAck: false },
  );

  return {
    async close() {
      try { await channel.cancel(consumerTag); } catch { /* noop */ }
      try { await channel.close(); } catch { /* noop */ }
      try { await conn.close(); } catch { /* noop */ }
    },
    channel,
    conn,
  };
}

module.exports = { EXCHANGE, DLX, connect, assertTopology, makePublisher, makeConsumer };
