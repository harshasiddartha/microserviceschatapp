'use strict';

const express = require('express');
const { auth, logger: log, metrics: metricsFactory, config } = require('@chat/shared');
const { UserStore } = require('./users');

function createApp({ users = new UserStore(), cfg = config.loadConfig(), logger = log.createLogger('auth') } = {}) {
  const app = express();
  const metrics = metricsFactory.makeRegistry('auth');
  app.use(express.json());
  app.use(metrics.httpTimingMiddleware());

  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'auth' }));
  app.get('/metrics', metrics.metricsEndpoint());

  app.post('/register', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'username and password (>=6 chars) required' });
    }
    try {
      const user = users.create({ username, password });
      const token = auth.signToken({ sub: user.id, username: user.username }, cfg.jwtSecret);
      return res.status(201).json({ user, token });
    } catch (err) {
      if (err.code === 'CONFLICT') return res.status(409).json({ error: err.message });
      logger.error({ err }, 'register failed');
      return res.status(500).json({ error: 'internal error' });
    }
  });

  app.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = users.authenticate({ username, password });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const token = auth.signToken({ sub: user.id, username: user.username }, cfg.jwtSecret);
    return res.json({ user, token });
  });

  app.get('/verify', auth.authMiddleware(cfg.jwtSecret), (req, res) => {
    res.json({ user: { id: req.user.sub, username: req.user.username } });
  });

  app.get('/users/:id', auth.authMiddleware(cfg.jwtSecret), (req, res) => {
    const user = users.find(req.params.id);
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json({ user });
  });

  return { app, metrics, cfg, users };
}

module.exports = { createApp };
