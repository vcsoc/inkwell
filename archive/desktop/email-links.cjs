'use strict';
const { isIP } = require('node:net');
module.exports = (value, origin) => {
  try {
    if (value.length > 8192 || /[\s\\\x00-\x1f\x7f]/.test(value)) return false;
    const url = new URL(value),
      host = url.hostname.toLowerCase().replace(/\.$/, '');
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !isIP(host) &&
      !host.includes(':') &&
      host !== new URL(origin).hostname &&
      !host.endsWith('.localhost') &&
      !host.endsWith('.local') &&
      !host.endsWith('.internal') &&
      /^[a-z0-9.-]+\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(host)
    );
  } catch {
    return false;
  }
};
