'use strict';
// No renderer IPC: only fixed endpoints on our authenticated, private backend.
module.exports = (window, origin, { Notification }) => {
  let polling = false;
  // Some desktop servers interpret notification bodies as markup.
  const plain = (value, limit) =>
    String(value || '')
      .slice(0, limit)
      .replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'))
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const pending = new Set(),
    unacknowledged = new Map(),
    notices = new Set();
  const request = (path, options = {}) =>
    window.webContents.session.fetch(origin + '/api/calendar/reminders' + path, {
      ...options,
      signal: AbortSignal.timeout(5000),
      headers: { Origin: origin, 'X-Inkwell': '1', 'Content-Type': 'application/json' },
    });
  const acknowledge = async (item) => {
    try {
      const response = await request('/ack', {
        method: 'POST',
        body: JSON.stringify({ key: item.key, event_id: item.event_id }),
      });
      if (response.ok) unacknowledged.delete(item.key);
    } catch {
      /* Retry persistence without showing the same toast again. */
    }
  };
  const poll = async () => {
    if (polling || window.isDestroyed() || !Notification.isSupported()) return;
    polling = true;
    try {
      await Promise.all(
        [...unacknowledged.values()].map((item) => {
          if (new Date(item.start) <= new Date()) {
            unacknowledged.delete(item.key);
            return;
          }
          return acknowledge(item);
        }),
      );
      const response = await request('');
      if (!response.ok) return;
      const data = await response.json();
      if (window.isDestroyed()) return;
      for (const item of (data.reminders || []).slice(0, 20)) {
        if (
          !/^[a-f0-9]{64}$/.test(item.key) ||
          pending.has(item.key) ||
          !Number.isSafeInteger(item.event_id)
        )
          continue;
        const start = new Date(item.start);
        if (!Number.isFinite(start.getTime()) || start <= new Date()) continue;
        const minutes = Math.ceil((start - Date.now()) / 60000);
        const notice = new Notification({
          title: 'Inkwell · Meeting reminder',
          body: `${plain(item.title, 200)}\nStarts in ${minutes} minutes · ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${item.location ? '\n' + plain(item.location, 300) : ''}`,
        });
        pending.add(item.key);
        notices.add(notice);
        notice.on('show', () => {
          unacknowledged.set(item.key, item);
          void acknowledge(item);
        });
        notice.on('failed', () => {
          pending.delete(item.key);
          notices.delete(notice);
        });
        notice.on('close', () => notices.delete(notice));
        notice.on('click', () => {
          if (!window.isDestroyed()) {
            window.restore();
            window.show();
            window.focus();
          }
        });
        try {
          notice.show();
        } catch {
          pending.delete(item.key);
          notices.delete(notice);
        }
      }
      // Retain only current occurrences, keeping long sessions bounded.
      const current = new Set((data.reminders || []).map((item) => item.key));
      for (const key of pending) if (!current.has(key)) pending.delete(key);
    } catch {
      /* Backend startup, locked session or temporary failure: retry, never claim delivery. */
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(poll, 15000);
  timer.unref();
  window.webContents.on('did-finish-load', poll);
  window.once('closed', () => {
    clearInterval(timer);
    for (const notice of notices) notice.close();
  });
  return { poll };
};
