'use strict';
window.InkwellProviderChangeNotice = (result) =>
  result?.provider_queued
    ? `${result.provider_queued} change${result.provider_queued === 1 ? '' : 's'} queued for server sync. Check the footer for completion or failures.`
    : 'Local change only. Server mail is unchanged.';
window.InkwellBackgroundSync = ({
  api,
  refresh,
  toast,
  onComplete = () => {},
  hasAccounts = () => false,
}) => {
  let active = false,
    timer = null,
    last = '',
    request = null,
    requestMode = null,
    completed = 0,
    refreshPending = false,
    refreshing = false,
    providerPolling = false;
  const deadline = () => ({ signal: AbortSignal.timeout(10000) });
  const badge = document.createElement('div');
  badge.id = 'sync-progress';
  badge.className = 'sync-footer';
  badge.setAttribute('role', 'status');
  badge.hidden = true;
  document.querySelector('#app-footer').prepend(badge);
  const providerBadge = document.createElement('div');
  providerBadge.id = 'provider-write-progress';
  providerBadge.className = 'provider-footer';
  providerBadge.setAttribute('role', 'status');
  providerBadge.hidden = true;
  badge.after(providerBadge);
  const pollProvider = async () => {
    if (providerPolling) return;
    providerPolling = true;
    try {
      const status = await api('/provider-sync', deadline());
      const needsAccess = status.authorization_required && !status.explicit_local_only;
      providerBadge.hidden =
        !status.pending && !status.failed && !status.cancelled && !needsAccess && !status.completed;
      providerBadge.textContent = status.failed
        ? `${status.failed} provider change${status.failed === 1 ? '' : 's'} failed · review Settings → Mail accounts`
        : status.cancelled
          ? `${status.cancelled} provider change${status.cancelled === 1 ? '' : 's'} cancelled after disconnect`
          : status.pending
            ? `${status.pending} server change${status.pending === 1 ? '' : 's'} queued`
            : needsAccess
              ? 'Server mail changes need Microsoft write access'
              : `${status.completed} server change${status.completed === 1 ? '' : 's'} synchronized`;
      if (needsAccess) {
        const link = document.createElement('a');
        link.href = '#/settings/mail';
        link.textContent = ' · Grant access';
        providerBadge.append(link);
      }
      providerBadge.title =
        status.last_error ||
        (needsAccess
          ? 'Open Mail accounts and approve Grant mail/calendar access. Moves and deletion will not silently change only the local copy.'
          : 'Microsoft Graph changes retry automatically while Inkwell is running.');
    } catch {
      // Keep the last known provider write result until the server answers again.
    } finally {
      providerPolling = false;
    }
  };
  void pollProvider();
  setInterval(pollProvider, 5000);
  const refreshWorkspace = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      while (refreshPending) {
        refreshPending = false;
        await refresh();
      }
    } catch {
      // Retry on the next status response without blocking the status poll.
      refreshPending = true;
    } finally {
      refreshing = false;
    }
  };
  const apply = (status) => {
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
      refreshPending = true;
    }
    if (refreshPending) void refreshWorkspace();
    if (!active && status.id > completed) {
      completed = status.id;
      if (status.added > 0)
        void Promise.resolve()
          .then(() => onComplete(status))
          .catch(() => {});
    }
  };
  // Serialize the GET and POST snapshots so an older response cannot replace newer status.
  const run = (mode, reportError = false) => {
    if (request) {
      if (mode === 'full' && requestMode !== 'full')
        return request.then(() => run(mode, reportError));
      if (mode === 'start' && requestMode === 'poll')
        return request.then(() => (active ? undefined : run(mode, reportError)));
      return request;
    }
    clearTimeout(timer);
    requestMode = mode;
    request = (async () => {
      let failed = false;
      try {
        apply(
          await api('/sync/jobs' + (mode === 'full' ? '?full=true' : ''), {
            ...deadline(),
            method: mode === 'poll' ? 'GET' : 'POST',
          }),
        );
      } catch (error) {
        failed = true;
        active = false;
        document.documentElement.dataset.syncing = 'false';
        badge.hidden = false;
        badge.title = '';
        badge.textContent = 'Sync status unavailable · retrying automatically';
        if (reportError) toast(error.message);
      } finally {
        request = requestMode = null;
        timer = setTimeout(tick, failed ? 5000 : active ? 2000 : 15000, failed);
      }
    })();
    return request;
  };
  const tick = (recovering = false) => {
    if (active || recovering) void run('poll');
    else if (hasAccounts()) void run('start');
    else timer = setTimeout(tick, 15000);
  };
  timer = setTimeout(tick, 15000);
  window.addEventListener('online', () => void run('poll'));
  return {
    get active() {
      return active;
    },
    start: (full = false) => run(full ? 'full' : 'start', full),
    poll: () => run('poll'),
  };
};
