'use strict';
window.InkwellBackgroundSync = ({ api, refresh, toast }) => {
  let active = false,
    timer = null,
    last = '',
    polling = false;
  const badge = document.createElement('div');
  badge.id = 'sync-progress';
  badge.className = 'sync-progress';
  badge.setAttribute('role', 'status');
  badge.hidden = true;
  document.querySelector('#page-title').parentElement.append(badge);
  const apply = async (status) => {
    active = status.active;
    document.documentElement.dataset.syncing = String(active);
    badge.hidden = !active && !status.errors.length;
    badge.textContent = active
      ? `Syncing ${status.current || 'mail'} · ${status.done}/${status.total} folders · ${status.added} new`
      : status.errors.length
        ? `Sync finished with ${status.errors.length} issue(s). F9 retries.`
        : '';
    badge.title = status.errors.map((e) => `${e.name}: ${e.error}`).join('\n');
    const revision = status.id + ':' + status.revision;
    if (revision !== last) {
      last = revision;
      await refresh();
    }
    clearTimeout(timer);
    if (active) timer = setTimeout(poll, 2000);
  };
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      await apply(await api('/sync/jobs'));
    } catch {
      timer = setTimeout(poll, 5000);
    } finally {
      polling = false;
    }
  };
  return {
    get active() {
      return active;
    },
    async start(full = false) {
      try {
        await apply(await api('/sync/jobs' + (full ? '?full=true' : ''), { method: 'POST' }));
      } catch (error) {
        toast(error.message);
      }
    },
    poll,
  };
};
