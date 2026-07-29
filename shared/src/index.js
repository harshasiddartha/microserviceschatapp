'use strict';

module.exports = {
  logger: require('./logger'),
  rabbit: require('./rabbit'),
  redis: require('./redis'),
  auth: require('./auth'),
  metrics: require('./metrics'),
  config: require('./config'),
};
