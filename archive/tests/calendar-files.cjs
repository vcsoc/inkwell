const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const create = require('../desktop/calendar-files.cjs');
const content = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

test(
  'calendar arguments preserve spaces, support local file URLs and never execute contents',
  { timeout: 2000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-file-association-'));
    try {
      const file = path.join(dir, 'Meeting with spaces.ics');
      fs.writeFileSync(file, content);
      const queue = create();
      queue.argumentsFrom(['inkwell', '--open-calendar', 'Meeting with spaces.ics'], dir);
      assert.deepEqual(await queue.next(), { filename: 'Meeting with spaces.ics', content });
      queue.enqueue([pathToFileURL(file).href]);
      assert.equal((await queue.next()).content, content);
      assert.equal(await queue.next(), null);
      queue.enqueue(['https://evil.example/invite.ics']);
      assert.ok((await queue.next()).error);
      const bad = path.join(dir, 'not-calendar.ics');
      fs.writeFileSync(bad, 'console.log("not a calendar")');
      queue.enqueue([bad]);
      assert.ok((await queue.next()).error);
      const large = path.join(dir, 'large.ics');
      fs.writeFileSync(large, 'x'.repeat(2000001));
      queue.enqueue([large]);
      assert.ok((await queue.next()).error);
      const folder = path.join(dir, 'folder.ics');
      fs.mkdirSync(folder);
      queue.enqueue([folder]);
      assert.ok((await queue.next()).error);
      assert.equal(fs.readFileSync(file, 'utf8'), content);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'queued calendar capability rejects frames and non-app documents',
  { timeout: 2000 },
  async () => {
    const queue = create(),
      window = new EventEmitter(),
      wc = new EventEmitter();
    let handler;
    Object.assign(wc, {
      mainFrame: { frameTreeNodeId: 1 },
      getURL: () => 'http://127.0.0.1:54321/',
      isLoadingMainFrame: () => false,
      send: () => {},
    });
    Object.assign(window, {
      webContents: wc,
      isDestroyed: () => false,
      isMinimized: () => false,
      show: () => {},
      focus: () => {},
    });
    queue.attach(window, 'http://127.0.0.1:54321', {
      handle: (_name, fn) => (handler = fn),
      removeHandler: () => {},
    });
    try {
      const event = {
        sender: wc,
        senderFrame: { frameTreeNodeId: 1, url: 'http://127.0.0.1:54321/#/calendar' },
      };
      assert.equal(await handler(event), null);
      assert.throws(() =>
        handler({ ...event, senderFrame: { ...event.senderFrame, frameTreeNodeId: 2 } }),
      );
      assert.throws(() =>
        handler({
          ...event,
          senderFrame: { ...event.senderFrame, url: 'http://127.0.0.1:54321/api/messages/1/html' },
        }),
      );
      assert.throws(() =>
        handler({ ...event, senderFrame: { ...event.senderFrame, url: 'https://evil.example/' } }),
      );
      queue.enqueue(Array(11).fill('/tmp/calendar.ics'));
      assert.ok((await queue.next()).error);
    } finally {
      window.emit('closed');
    }
  },
);
