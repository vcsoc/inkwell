const { test } = require('node:test');
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { sidebarClick } = require('./ui/helpers.cjs');
const ics = (title) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${title}@native.example\r\nDTSTART:20990102T100000Z\r\nDTEND:20990102T110000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
test(
  'OS calendar files work at startup and in a running app without replacing a draft',
  { timeout: 14000 },
  async (t) => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-native-calendar-file-'));
    const cold = path.join(data, 'Meeting with spaces.ics'),
      warm = path.join(data, 'Another meeting.ics');
    fs.writeFileSync(cold, ics('Cold meeting'));
    fs.writeFileSync(warm, ics('Warm meeting'));
    let app;
    t.signal.addEventListener('abort', () => app?.close().catch(() => {}), { once: true });
    try {
      app = await electron.launch({
        executablePath: process.env.INKWELL_TEST_EXECUTABLE || undefined,
        args: [
          ...(process.env.INKWELL_TEST_EXECUTABLE ? [] : ['.']),
          `--user-data-dir=${path.join(data, 'profile')}`,
          '--open-calendar',
          cold,
        ],
        env: { ...process.env, INKWELL_DATA_DIR: data },
        timeout: 5000,
      });
      const window = await app.firstWindow({ timeout: 5000 });
      window.setDefaultTimeout(3000);
      await expect(window.locator('#calendar-import-preview')).toContainText('Cold meeting');
      expect(
        await window.evaluate(async () => (await (await fetch('/api/events')).json()).length),
      ).toBe(0);
      await window.getByRole('button', { name: 'Add to local calendar', exact: true }).click();
      await expect(window.locator('.agenda')).toContainText('Cold meeting');
      await sidebarClick(window, '#navigation [data-view=inbox]');
      await window.locator('#heading-compose').click();
      await window.getByLabel('Subject', { exact: true }).fill('Preserve association draft');
      await app.evaluate(
        ({ app }, file) =>
          app.emit('second-instance', {}, ['inkwell', '--open-calendar', file], process.cwd()),
        warm,
      );
      await expect(window.locator('#toast')).toContainText('Calendar file queued');
      await expect(window.getByLabel('Subject', { exact: true })).toHaveValue(
        'Preserve association draft',
      );
      await window.locator('#close-modal').click();
      await expect(window.locator('#calendar-import-preview')).toContainText('Warm meeting');
      expect(
        await window.evaluate(async () =>
          (await (await fetch('/api/messages?folder=drafts')).json()).some(
            (m) => m.subject === 'Preserve association draft',
          ),
        ),
      ).toBe(true);
      await window.getByRole('button', { name: 'Add to local calendar', exact: true }).click();
      await expect(window.locator('.agenda')).toContainText('Warm meeting');
      expect(
        await window.evaluate(async () => (await (await fetch('/api/events')).json()).length),
      ).toBe(2);
      // Exercise the native download path, then open that saved ICS through the same OS queue.
      const messageId = await window.evaluate(async () => {
        const headers = { 'X-Inkwell': '1', 'Content-Type': 'application/json' };
        const m = await (
          await fetch('/api/drafts', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              subject: 'Native attachment',
              body: 'Attachment download verification',
            }),
          })
        ).json();
        await fetch('/api/messages/' + m.id, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ folder: 'inbox' }),
        });
        return m.id;
      });
      const saved = path.join(data, 'Downloaded meeting.ics'),
        token = 'd'.repeat(64);
      const metadata = {
        connected: true,
        complete: true,
        pending: 0,
        error: '',
        scope: 'thread',
        groups: [
          {
            key: 'root',
            selected: true,
            subject: 'Native attachment',
            sender: 'Test',
            date: '2099-01-02T10:00:00Z',
            files: [
              {
                id: token,
                name: 'Downloaded meeting.ics',
                kind: 'file',
                size: 200,
                inline: false,
                cached_only: false,
                downloadable: true,
              },
            ],
          },
        ],
      };
      await window.route(`**/api/messages/${messageId}/attachments**`, (route) =>
        route.request().url().endsWith('/download')
          ? route.fulfill({
              contentType: 'application/octet-stream',
              body: ics('Attachment meeting'),
            })
          : route.fulfill({ json: metadata }),
      );
      await app.evaluate(({ session }, file) => {
        globalThis.inkwellAttachmentDownload = new Promise((resolve) =>
          session.defaultSession.once('will-download', (_event, item) => {
            item.setSavePath(file);
            item.once('done', (_event, state) => resolve(state));
          }),
        );
      }, saved);
      await sidebarClick(window, '#navigation [data-view=inbox]');
      await window.locator(`[data-message="${messageId}"] .subject`).click();
      await expect(window.locator('#message-attachments')).toContainText('Downloaded meeting.ics');
      expect(fs.existsSync(saved)).toBe(false);
      await window
        .getByRole('button', { name: 'Download Downloaded meeting.ics', exact: true })
        .click();
      expect(await app.evaluate(async () => await globalThis.inkwellAttachmentDownload)).toBe(
        'completed',
      );
      expect(fs.readFileSync(saved, 'utf8')).toBe(ics('Attachment meeting'));
      await app.evaluate(
        ({ app }, file) =>
          app.emit('second-instance', {}, ['inkwell', '--open-calendar', file], process.cwd()),
        saved,
      );
      await expect(window.locator('#calendar-import-preview')).toContainText('Attachment meeting');
      expect(
        await window.evaluate(async () => (await (await fetch('/api/events')).json()).length),
      ).toBe(2);
      expect(fs.readFileSync(cold, 'utf8')).toBe(ics('Cold meeting'));
    } finally {
      if (app) await app.close().catch(() => {});
      fs.rmSync(data, { recursive: true, force: true });
    }
  },
);
