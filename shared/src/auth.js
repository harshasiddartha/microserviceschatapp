'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, s, 64).toString('hex');
  return `${s}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signToken(payload, secret, opts = {}) {
  return jwt.sign(payload, secret, { expiresIn: '7d', ...opts });
}

function verifyToken(token, secret) {
  return jwt.verify(token, secret);
}

function authMiddleware(secret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: 'missing bearer token' });
    try {
      req.user = verifyToken(m[1], secret);
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid token' });
    }
  };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, authMiddleware };
