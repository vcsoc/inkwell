'use strict';
window.InkwellBackgroundSync = ({ api, refresh, toast, hasAccounts = () => false }) => {
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
    badge.hidden = !active && !status.errors.length && !status.pending;
    badge.textContent =
      status.retry_at > Date.now() / 1000
        ? `Microsoft requested a pause · automatic retry after ${new Date(status.retry_at * 1000).toLocaleTimeString()}`
        : active
          ? `Syncing ${status.current || 'mail'} · ${status.done}/${status.total} folders · ${status.added} new`
          : status.errors.length
            ? `Sync finished with ${status.errors.length} issue(s). Sync retries.`
            : status.pending
              ? `Downloading remaining history · ${status.pending} folders · resumes automatically`
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
  const controller = {
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
  setInterval(() => {
    if (hasAccounts() && !active && !polling) void controller.start();
  }, 15000);
  return controller;
};
