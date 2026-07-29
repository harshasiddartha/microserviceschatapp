'use strict';

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function loadConfig() {
  return {
    env: process.env.NODE_ENV || 'development',
    jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
    rabbitUrl: process.env.RABBIT_URL || 'amqp://guest:guest@rabbit:5672',
    redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
    ports: {
      auth: num(process.env.AUTH_PORT, 4001),
      chat: num(process.env.CHAT_PORT, 4002),
      notif: num(process.env.NOTIF_PORT, 4003),
    },
    presenceTtlSec: num(process.env.PRESENCE_TTL_SEC, 60),
    prefetch: num(process.env.RABBIT_PREFETCH, 16),
  };
}

module.exports = { loadConfig };
