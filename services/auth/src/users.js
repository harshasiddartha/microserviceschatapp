'use strict';

const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('@chat/shared').auth;

class UserStore {
  constructor() {
    this.byId = new Map();
    this.byUsername = new Map();
  }

  create({ username, password }) {
    if (this.byUsername.has(username)) {
      const err = new Error('username already exists');
      err.code = 'CONFLICT';
      throw err;
    }
    const id = crypto.randomUUID();
    const passwordHash = hashPassword(password);
    const user = { id, username, passwordHash, createdAt: new Date().toISOString() };
    this.byId.set(id, user);
    this.byUsername.set(username, user);
    return { id, username, createdAt: user.createdAt };
  }

  authenticate({ username, password }) {
    const user = this.byUsername.get(username);
    if (!user) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;
    return { id: user.id, username: user.username };
  }

  find(id) {
    const u = this.byId.get(id);
    return u ? { id: u.id, username: u.username } : null;
  }
}

module.exports = { UserStore };
