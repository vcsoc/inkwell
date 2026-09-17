'use strict';
// Calendar boundaries, not rolling 24-hour periods. Naive cached timestamps are UTC,
// matching the server's sorting; grouping uses the viewer's local calendar.
window.InkwellDateGroups = (now = new Date()) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return (value) => {
    if (typeof value !== 'string') return 'Unknown date';
    const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/);
    if (!parts) return 'Unknown date';
    const [year, mon, day] = parts.slice(1).map(Number);
    if (
      !year ||
      mon < 1 ||
      mon > 12 ||
      day < 1 ||
      day > new Date(Date.UTC(year, mon, 0)).getUTCDate()
    )
      return 'Unknown date';
    let normalized = value.replace(' ', 'T');
    if (normalized.length === 10) normalized += 'T00:00:00';
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += 'Z';
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    if (date >= tomorrow) return 'Future';
    if (date >= today) return 'Today';
    if (date >= week) return 'This Week';
    if (date >= month) return 'This Month';
    return 'Older';
  };
};
