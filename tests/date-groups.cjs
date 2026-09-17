const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { window: {}, Date };
vm.runInNewContext(
  fs.readFileSync(require('node:path').join(__dirname, '../inkwell/static/date-groups.js'), 'utf8'),
  context,
);
const classify = context.window.InkwellDateGroups;
test(
  'date groups are disjoint, Monday-based and respect local month/year boundaries',
  { timeout: 1000 },
  () => {
    for (const zone of ['America/New_York', 'Europe/Dublin', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      const group = classify(new Date(2026, 8, 17, 12));
      const value = (month, day) => new Date(2026, month, day, 12).toISOString();
      assert.equal(group(value(8, 17)), 'Today');
      assert.equal(group(value(8, 15)), 'This Week');
      assert.equal(group(value(8, 3)), 'This Month');
      assert.equal(group(value(7, 30)), 'Older');
      assert.equal(group(value(8, 18)), 'Future');
      assert.equal(group('2026-02-30T10:00:00Z'), 'Unknown date');
      assert.equal(group(null), 'Unknown date');
      assert.equal(group('2026-09-17 00:30:00'), group('2026-09-17T00:30:00Z'));
      assert.equal(
        classify(new Date(2026, 0, 1, 12))(new Date(2025, 11, 31, 12).toISOString()),
        'This Week',
      );
      assert.equal(
        classify(new Date(2026, 5, 1, 12))(new Date(2026, 4, 31, 12).toISOString()),
        'Older',
      );
    }
  },
);
test('DST calendar days are not rolling 24-hour windows', { timeout: 1000 }, () => {
  process.env.TZ = 'America/New_York';
  const spring = classify(new Date('2026-03-08T16:00:00Z'));
  assert.equal(spring('2026-03-08T04:59:59Z'), 'This Week');
  assert.equal(spring('2026-03-08T05:00:00Z'), 'Today');
  assert.equal(spring('2026-03-09T03:59:59Z'), 'Today');
  assert.equal(spring('2026-03-09T04:00:00Z'), 'Future');
  const fall = classify(new Date('2026-11-01T18:00:00Z'));
  assert.equal(fall('2026-11-01T04:00:00Z'), 'Today');
  assert.equal(fall('2026-11-02T04:59:59Z'), 'Today');
  assert.equal(fall('2026-11-02T05:00:00Z'), 'Future');
});
