const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const install = require('../desktop/calendar-reminders.cjs');

test(
  'native reminders use fixed authenticated endpoints, deduplicate, acknowledge display and focus safely',
  { timeout: 2000 },
  async () => {
    const window = new EventEmitter(),
      web = new EventEmitter(),
      calls = [],
      shown = [];
    let focused = 0;
    window.webContents = web;
    window.isDestroyed = () => false;
    window.restore = window.show = () => {};
    window.focus = () => focused++;
    const item = {
      key: 'a'.repeat(64),
      event_id: 42,
      title: 'Planning <script>',
      start: new Date(Date.now() + 15 * 60000).toISOString(),
      location: 'https://example.org/room',
    };
    web.session = {
      fetch: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ reminders: [item] }) };
      },
    };
    class Notice extends EventEmitter {
      static isSupported() {
        return true;
      }
      constructor(options) {
        super();
        this.options = options;
        shown.push(this);
      }
      show() {
        this.emit('show');
      }
      close() {}
    }
    const controller = install(window, 'http://127.0.0.1:12345', { Notification: Notice });
    try {
      await controller.poll();
      await controller.poll();
      assert.equal(shown.length, 1);
      assert.match(shown[0].options.body, /Planning ‹script›/);
      assert.ok(!shown[0].options.body.includes('<'));
      assert.equal(calls.filter((c) => c.url.endsWith('/ack')).length, 1);
      assert.ok(
        calls.every((c) => c.url.startsWith('http://127.0.0.1:12345/api/calendar/reminders')),
      );
      assert.ok(calls.every((c) => c.options.headers['X-Inkwell'] === '1'));
      shown[0].emit('click');
      assert.equal(focused, 1);
    } finally {
      window.emit('closed');
    }
  },
);

test(
  'acknowledgement failures retry persistence without another OS toast',
  { timeout: 2000 },
  async () => {
    const window = new EventEmitter();
    window.isDestroyed = () => false;
    window.webContents = new EventEmitter();
    let shown = 0,
      acks = 0;
    const item = {
      key: 'c'.repeat(64),
      event_id: 3,
      title: 'Persist',
      start: new Date(Date.now() + 60000).toISOString(),
    };
    window.webContents.session = {
      fetch: async (url) =>
        url.endsWith('/ack')
          ? { ok: ++acks > 1 }
          : { ok: true, json: async () => ({ reminders: [item] }) },
    };
    class Notice extends EventEmitter {
      static isSupported() {
        return true;
      }
      show() {
        shown++;
        this.emit('show');
      }
      close() {}
    }
    const controller = install(window, 'http://127.0.0.1:12345', { Notification: Notice });
    try {
      await controller.poll();
      await controller.poll();
      assert.equal(shown, 1);
      assert.equal(acks, 2);
    } finally {
      window.emit('closed');
    }
  },
);

test('failed OS notifications are not acknowledged and can retry', { timeout: 2000 }, async () => {
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.webContents = new EventEmitter();
  let shown = 0,
    acks = 0;
  window.webContents.session = {
    fetch: async (url) => {
      if (url.endsWith('/ack')) acks++;
      return {
        ok: true,
        json: async () => ({
          reminders: [
            {
              key: 'b'.repeat(64),
              event_id: 2,
              title: 'Retry',
              start: new Date(Date.now() + 60000).toISOString(),
            },
          ],
        }),
      };
    },
  };
  class Notice extends EventEmitter {
    static isSupported() {
      return true;
    }
    show() {
      shown++;
      this.emit('failed');
    }
    close() {}
  }
  const controller = install(window, 'http://127.0.0.1:12345', { Notification: Notice });
  try {
    await controller.poll();
    await controller.poll();
    assert.equal(shown, 2);
    assert.equal(acks, 0);
  } finally {
    window.emit('closed');
  }
});
