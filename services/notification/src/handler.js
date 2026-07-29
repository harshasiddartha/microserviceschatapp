'use strict';

class NotificationHandler {
  constructor({ logger, redisClient = null, presenceModule = null }) {
    this.logger = logger;
    this.redis = redisClient;
    this.presenceModule = presenceModule;
    this.sent = [];
    this.dropped = [];
  }

  async handle(message) {
    if (!message?.id || !message?.roomId || !message?.fromUserId) {
      throw new Error('malformed message');
    }
    let recipientOnline = true;
    if (this.redis && this.presenceModule) {
      recipientOnline = await this.presenceModule.isOnline(this.redis, message.fromUserId);
    }
    const notification = {
      messageId: message.id,
      roomId: message.roomId,
      fromUserId: message.fromUserId,
      fromUsername: message.fromUsername,
      body: message.body,
      channel: recipientOnline ? 'realtime' : 'push',
      deliveredAt: new Date().toISOString(),
    };
    this.sent.push(notification);
    this.logger?.info({ id: message.id, channel: notification.channel }, 'notification delivered');
    return notification;
  }
}

module.exports = { NotificationHandler };
