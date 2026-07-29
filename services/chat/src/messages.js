'use strict';

const crypto = require('crypto');

class MessageStore {
  constructor() {
    this.byRoom = new Map();
  }

  append({ roomId, fromUserId, fromUsername, body }) {
    const msg = {
      id: crypto.randomUUID(),
      roomId,
      fromUserId,
      fromUsername,
      body,
      createdAt: new Date().toISOString(),
    };
    if (!this.byRoom.has(roomId)) this.byRoom.set(roomId, []);
    this.byRoom.get(roomId).push(msg);
    return msg;
  }

  list(roomId, { limit = 50, before } = {}) {
    const arr = this.byRoom.get(roomId) || [];
    let filtered = arr;
    if (before) filtered = arr.filter((m) => m.createdAt < before);
    return filtered.slice(-limit);
  }
}

module.exports = { MessageStore };
