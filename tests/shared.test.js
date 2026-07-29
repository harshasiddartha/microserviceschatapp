'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auth } = require('@chat/shared');

test('auth: hashPassword + verifyPassword roundtrip', () => {
  const stored = auth.hashPassword('hunter2');
  assert.ok(stored.includes(':'));
  assert.ok(auth.verifyPassword('hunter2', stored));
  assert.ok(!auth.verifyPassword('wrong', stored));
});

test('auth: different salts produce different hashes for same password', () => {
  const a = auth.hashPassword('hunter2');
  const b = auth.hashPassword('hunter2');
  assert.notEqual(a, b);
  assert.ok(auth.verifyPassword('hunter2', a));
  assert.ok(auth.verifyPassword('hunter2', b));
});

test('auth: signToken + verifyToken roundtrip', () => {
  const t = auth.signToken({ sub: 'u1', username: 'alice' }, 'secret');
  const decoded = auth.verifyToken(t, 'secret');
  assert.equal(decoded.sub, 'u1');
  assert.equal(decoded.username, 'alice');
});

test('auth: verifyToken rejects wrong secret', () => {
  const t = auth.signToken({ sub: 'u1' }, 'secretA');
  assert.throws(() => auth.verifyToken(t, 'secretB'));
});
