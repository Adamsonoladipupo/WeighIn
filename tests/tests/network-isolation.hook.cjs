/**
 * Network isolation hook preventing unauthorized outbound sockets during unit tests.
 */
const net = require('net');

const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function(...args) {
  const host = args[0] && typeof args[0] === 'object' ? args[0].host : args[1];
  const allowedHosts = ['localhost', '127.0.0.1', '::1'];

  if (host && !allowedHosts.includes(host)) {
    const err = new Error(`Network isolation violation: Outbound connection to '${host}' is blocked.`);
    err.code = 'EPERM_NETWORK_ISOLATION';
    this.emit('error', err);
    return this;
  }

  return originalConnect.apply(this, args);
};
