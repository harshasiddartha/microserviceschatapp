'use strict';

const express = require('express');
const { logger: log, metrics: metricsFactory, config } = require('@chat/shared');

function createApp({
  handler,
  cfg = config.loadConfig(),
  logger = log.createLogger('notification'),
} = {}) {
  const app = express();
  const metrics = metricsFactory.makeRegistry('notification');
  app.use(express.json());
  app.use(metrics.httpTimingMiddleware());

  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'notification' }));
  app.get('/metrics', metrics.metricsEndpoint());

  app.get('/notifications/recent', (_req, res) => {
    const recent = handler?.sent.slice(-50) || [];
    res.json({ notifications: recent });
  });

  return { app, metrics, cfg };
}

module.exports = { createApp };
