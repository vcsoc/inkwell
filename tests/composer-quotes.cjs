const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sandbox = { window: {}, Date };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../inkwell/static/composer-quotes.js'), 'utf8'),
  sandbox,
);
const quote = sandbox.window.InkwellComposeQuote;
const message = {
  sender: 'Alex <alex@example.test>',
  subject: 'Project update',
  account_id: 3,
  date: '2026-10-27T14:30:00Z',
};
test('reply removes imported padding and empty quote markers without losing paragraphs', () => {
  const source = {
    ...message,
    body: '\r\n\r\n> \r\n> > \r\nFirst paragraph\r\n\r\n\r\n> \r\nSecond paragraph\r\n\r\n',
  };
  const result = quote(source, 'reply');
  assert.equal(result.recipient, 'alex@example.test');
  assert.ok(result.body.endsWith('> First paragraph\n\n> Second paragraph'));
  assert.ok(!/\n{3}/.test(result.body));
  assert.ok(!/^[> \t]+$/m.test(result.body));
  assert.equal(source.body.includes('\r\n'), true);
});
test('repeated replies and forwards never accumulate blank lines or duplicate subject prefixes', () => {
  for (const action of ['reply', 'forward']) {
    let current = { ...message, body: '\n\nHello\n\n\nWorld\n\n' };
    for (let index = 0; index < 8; index++) {
      const next = quote(current, action);
      assert.ok(!/\n{3}/.test(next.body));
      assert.ok(!/^[> \t]+$/m.test(next.body));
      assert.ok(next.body.includes('Hello') && next.body.includes('World'));
      current = { ...current, ...next };
    }
    assert.equal(
      current.subject,
      action === 'reply' ? 'Re: Project update' : 'Fwd: Project update',
    );
  }
});
test('indentation and meaningful whitespace survive and bad dates are not printed', () => {
  const result = quote(
    { ...message, date: 'invalid', body: '  indented code  \n\nlast line' },
    'reply',
  );
  assert.ok(result.body.includes('>   indented code  '));
  assert.ok(!result.body.includes('Invalid Date'));
  assert.equal((result.body.match(/^\n+/) || [''])[0], '\n');
});
