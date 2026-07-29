'use strict';

const express = require('express');
const { auth, logger: log, metrics: metricsFactory, config, redis: redisMod } = require('@chat/shared');
const { MessageStore } = require('./messages');

function createApp({
  messages = new MessageStore(),
  publisher,
  redisClient = null,
  cfg = config.loadConfig(),
  logger = log.createLogger('chat'),
} = {}) {
  const app = express();
  const metrics = metricsFactory.makeRegistry('chat');
  app.use(express.json());
  app.use(metrics.httpTimingMiddleware());

  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'chat' }));
  app.get('/metrics', metrics.metricsEndpoint());

  const requireAuth = auth.authMiddleware(cfg.jwtSecret);

  app.post('/rooms/:roomId/messages', requireAuth, async (req, res) => {
    const { body } = req.body || {};
    if (!body || typeof body !== 'string' || body.length > 4096) {
      return res.status(400).json({ error: 'body required, max 4096 chars' });
    }
    const msg = messages.append({
      roomId: req.params.roomId,
      fromUserId: req.user.sub,
      fromUsername: req.user.username,
      body,
    });

    if (publisher) {
      try {
        await publisher.publish('message.sent', msg);
        metrics.messagesPublished.inc({ routing_key: 'message.sent' });
      } catch (err) {
        logger.error({ err, id: msg.id }, 'publish failed');
        return res.status(502).json({ error: 'queue unavailable' });
      }
    }

    return res.status(201).json({ message: msg });
  });

  app.get('/rooms/:roomId/messages', requireAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    const list = messages.list(req.params.roomId, { limit, before });
    res.json({ messages: list });
  });

  app.post('/presence/heartbeat', requireAuth, async (req, res) => {
    if (!redisClient) return res.json({ ok: true, tracked: false });
    await redisMod.heartbeat(redisClient, req.user.sub, cfg.presenceTtlSec);
    res.json({ ok: true, ttl: cfg.presenceTtlSec });
  });

  app.get('/presence', requireAuth, async (req, res) => {
    const ids = String(req.query.userIds || '').split(',').filter(Boolean);
    if (!redisClient) return res.json({ presence: Object.fromEntries(ids.map((i) => [i, false])) });
    const presence = await redisMod.whoIsOnline(redisClient, ids);
    res.json({ presence });
  });

  return { app, metrics, cfg, messages };
}

module.exports = { createApp };
