'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationHandler } = require('../services/notification/src/handler');

test('notification: handles well-formed message and marks channel', async () => {
  const h = new NotificationHandler({ logger: { info() {}, warn() {}, error() {} } });
  const n = await h.handle({
    id: 'm1',
    roomId: 'r1',
    fromUserId: 'u1',
    fromUsername: 'alice',
    body: 'hi',
  });
  assert.equal(n.messageId, 'm1');
  assert.equal(h.sent.length, 1);
  assert.equal(n.channel, 'realtime'); // no redis -> defaults to online
});

test('notification: rejects malformed message (throws so rabbit will retry)', async () => {
  const h = new NotificationHandler({ logger: { info() {}, warn() {}, error() {} } });
  await assert.rejects(() => h.handle({ id: 'x' }), /malformed/);
});

test('notification: presence lookup routes to push when user offline', async () => {
  const fakeRedis = {};
  const fakePresence = {
    async isOnline(_client, _userId) { return false; },
  };
  const h = new NotificationHandler({
    logger: { info() {}, warn() {}, error() {} },
    redisClient: fakeRedis,
    presenceModule: fakePresence,
  });
  const n = await h.handle({
    id: 'm2',
    roomId: 'r1',
    fromUserId: 'u1',
    fromUsername: 'alice',
    body: 'hi',
  });
  assert.equal(n.channel, 'push');
});
