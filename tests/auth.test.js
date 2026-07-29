'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../services/auth/src/app');

function listenOnce(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text();
  return { status: res.status, body };
}

test('auth: register + login + verify', async (t) => {
  const { app } = createApp({ cfg: { jwtSecret: 'test', ports: { auth: 0 } } });
  const { server, url } = await listenOnce(app);
  t.after(() => server.close());

  const r1 = await req(`${url}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'password' }),
  });
  assert.equal(r1.status, 201);
  assert.equal(r1.body.user.username, 'alice');
  const token = r1.body.token;
  assert.ok(token);

  const rDup = await req(`${url}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'password' }),
  });
  assert.equal(rDup.status, 409);

  const rBad = await req(`${url}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'wrong' }),
  });
  assert.equal(rBad.status, 401);

  const rGood = await req(`${url}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'password' }),
  });
  assert.equal(rGood.status, 200);
  assert.ok(rGood.body.token);

  const rVerify = await req(`${url}/verify`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(rVerify.status, 200);
  assert.equal(rVerify.body.user.username, 'alice');

  const rNoAuth = await req(`${url}/verify`);
  assert.equal(rNoAuth.status, 401);
});

test('auth: rejects short passwords', async (t) => {
  const { app } = createApp({ cfg: { jwtSecret: 'test', ports: { auth: 0 } } });
  const { server, url } = await listenOnce(app);
  t.after(() => server.close());

  const r = await req(`${url}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: '123' }),
  });
  assert.equal(r.status, 400);
});
