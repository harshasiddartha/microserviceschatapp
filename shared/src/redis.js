'use strict';

const Redis = require('ioredis');

function makeClient(url, { logger } = {}) {
  const client = new Redis(url, {
    maxRetriesPerRequest: 5,
    retryStrategy: (times) => Math.min(times * 200, 2000),
    lazyConnect: false,
  });
  client.on('error', (err) => logger?.error({ err }, 'redis error'));
  return client;
}

function presenceKey(userId) {
  return `presence:${userId}`;
}

function cacheKey(kind, id) {
  return `cache:${kind}:${id}`;
}

async function heartbeat(client, userId, ttlSec) {
  await client.set(presenceKey(userId), '1', 'EX', ttlSec);
}

async function isOnline(client, userId) {
  const v = await client.get(presenceKey(userId));
  return v === '1';
}

async function whoIsOnline(client, userIds) {
  if (!userIds.length) return {};
  const pipeline = client.pipeline();
  userIds.forEach((id) => pipeline.get(presenceKey(id)));
  const results = await pipeline.exec();
  const out = {};
  userIds.forEach((id, i) => {
    out[id] = results[i][1] === '1';
  });
  return out;
}

module.exports = { makeClient, presenceKey, cacheKey, heartbeat, isOnline, whoIsOnline };
