'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../services/chat/src/app');
const { auth } = require('@chat/shared');

function listenOnce(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function fakePublisher() {
  const published = [];
  return {
    published,
    async publish(routingKey, message) {
      published.push({ routingKey, message });
      return true;
    },
    async close() {},
  };
}

async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text();
  return { status: res.status, body };
}

test('chat: publishes on send and lists messages', async (t) => {
  const publisher = fakePublisher();
  const { app } = createApp({
    cfg: { jwtSecret: 'test', ports: { chat: 0 }, presenceTtlSec: 60 },
    publisher,
  });
  const { server, url } = await listenOnce(app);
  t.after(() => server.close());

  const token = auth.signToken({ sub: 'u1', username: 'alice' }, 'test');

  const send = await req(`${url}/rooms/general/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ body: 'hello world' }),
  });
  assert.equal(send.status, 201);
  assert.equal(send.body.message.body, 'hello world');
  assert.equal(publisher.published.length, 1);
  assert.equal(publisher.published[0].routingKey, 'message.sent');
  assert.equal(publisher.published[0].message.body, 'hello world');

  const list = await req(`${url}/rooms/general/messages`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(list.status, 200);
  assert.equal(list.body.messages.length, 1);
});

test('chat: 502 when publisher throws (message not silently lost)', async (t) => {
  const broken = {
    async publish() { throw new Error('rabbit down'); },
    async close() {},
  };
  const { app } = createApp({
    cfg: { jwtSecret: 'test', ports: { chat: 0 }, presenceTtlSec: 60 },
    publisher: broken,
  });
  const { server, url } = await listenOnce(app);
  t.after(() => server.close());

  const token = auth.signToken({ sub: 'u1', username: 'alice' }, 'test');
  const r = await req(`${url}/rooms/general/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ body: 'hi' }),
  });
  assert.equal(r.status, 502);
});

test('chat: rejects unauthenticated posts', async (t) => {
  const { app } = createApp({
    cfg: { jwtSecret: 'test', ports: { chat: 0 }, presenceTtlSec: 60 },
    publisher: fakePublisher(),
  });
  const { server, url } = await listenOnce(app);
  t.after(() => server.close());

  const r = await req(`${url}/rooms/general/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'hi' }),
  });
  assert.equal(r.status, 401);
});

test('chat: rejects oversized body', async (t) => {
  const { app } = createApp({
    cfg: { jwtSecret: 'test', ports: { chat: 0 }, presenceTtlSec: 60 },
    publisher: fakePublisher(),
  });
  const { server, url } = await listenOnce(app);
  t.after(() => server.close());

  const token = auth.signToken({ sub: 'u1', username: 'alice' }, 'test');
  const r = await req(`${url}/rooms/general/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ body: 'x'.repeat(4097) }),
  });
  assert.equal(r.status, 400);
});
