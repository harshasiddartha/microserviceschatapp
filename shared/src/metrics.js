'use strict';

const client = require('prom-client');

function makeRegistry(service) {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register: registry });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });

  const queueDepth = new client.Gauge({
    name: 'rabbit_queue_depth',
    help: 'Approximate queue depth (last observed)',
    labelNames: ['queue'],
    registers: [registry],
  });

  const messagesPublished = new client.Counter({
    name: 'chat_messages_published_total',
    help: 'Total chat messages published to the exchange',
    labelNames: ['routing_key'],
    registers: [registry],
  });

  const messagesConsumed = new client.Counter({
    name: 'chat_messages_consumed_total',
    help: 'Total messages consumed from a queue',
    labelNames: ['queue', 'outcome'],
    registers: [registry],
  });

  const consumerLatency = new client.Histogram({
    name: 'notification_handle_seconds',
    help: 'Time spent handling a queued message',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [registry],
  });

  function httpTimingMiddleware() {
    return (req, res, next) => {
      const end = httpDuration.startTimer();
      res.on('finish', () => {
        end({
          method: req.method,
          route: req.route?.path || req.path,
          status: String(res.statusCode),
        });
      });
      next();
    };
  }

  function metricsEndpoint() {
    return async (_req, res) => {
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    };
  }

  return {
    registry,
    httpDuration,
    queueDepth,
    messagesPublished,
    messagesConsumed,
    consumerLatency,
    httpTimingMiddleware,
    metricsEndpoint,
  };
}

module.exports = { makeRegistry };
