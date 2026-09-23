'use strict';
// Desktop updates are checked and installed by the trusted Electron main process.
window.InkwellUpdater = (() => {
  const desktop = window.inkwellUpdates;
  let notice, actions, progress, detail, heading;
  let deferred = '';
  let offered = '';
  let busy = false;
  let toast = () => {};
  function hide() {
    notice.classList.add('hidden');
  }
  function show() {
    notice.classList.remove('hidden');
  }
  function available(version) {
    offered = version;
    heading.textContent = `Inkwell ${version} is available`;
    detail.textContent = 'A new release is ready. Would you like to update now?';
    progress.hidden = true;
    actions.innerHTML =
      '<button type="button" class="primary" data-update-action="install" title="Download and verify this release, install it, then restart Inkwell to apply it.">Update</button><button type="button" class="secondary" data-update-action="later" title="Dismiss this reminder until the next time you start Inkwell.">Later</button><button type="button" class="secondary" data-update-action="skip" title="Do not prompt again for this specific version; newer versions will still be offered.">Skip version</button>';
    show();
  }
  function installing(status) {
    heading.textContent =
      status.phase === 'download' ? 'Downloading Inkwell update' : 'Installing Inkwell update';
    detail.textContent = status.detail;
    progress.hidden = false;
    progress.value = Math.max(0, Math.min(100, status.percent || 0));
    progress.setAttribute(
      'aria-label',
      status.phase === 'download' ? 'Download progress' : 'Installation progress',
    );
    actions.innerHTML = '';
    show();
  }
  async function check(manual = false) {
    if (!desktop) {
      if (manual) toast('Updates require the installed Linux desktop app.');
      return;
    }
    if (busy) return;
    try {
      const result = await desktop.check(manual);
      if (result.status === 'available' && (manual || deferred !== result.version))
        available(result.version);
      else if (manual && result.status === 'current')
        toast(`Inkwell ${result.version} is up to date.`);
      else if (manual && result.status === 'unsupported')
        toast('Automatic updates require the managed Linux desktop installation.');
      else if (manual && result.status === 'busy') toast('An update is already in progress.');
    } catch (error) {
      if (manual) toast('Update check failed: ' + error.message);
    }
  }
  function start(options) {
    toast = options.toast;
    notice = document.querySelector('#update-toast');
    actions = notice.querySelector('#update-actions');
    heading = notice.querySelector('#update-title');
    detail = notice.querySelector('#update-detail');
    progress = notice.querySelector('#update-progress');
    actions.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-update-action]')?.dataset.updateAction;
      if (!action || busy) return;
      if (action === 'later') {
        deferred = offered;
        hide();
        return;
      }
      if (action === 'skip') {
        try {
          await desktop.skip(offered);
          hide();
        } catch (error) {
          toast(error.message);
        }
        return;
      }
      if (action !== 'install') return;
      busy = true;
      installing({ phase: 'download', percent: 0, detail: 'Preparing secure download…' });
      try {
        const result = await desktop.install(offered);
        if (result.status === 'restart-needed') {
          heading.textContent = 'Update installed';
          detail.textContent =
            'Your draft could not be saved. Save it, then quit and reopen Inkwell to apply the update.';
          progress.hidden = true;
        }
      } catch (error) {
        heading.textContent = 'Update failed';
        detail.textContent = error.message;
        progress.hidden = true;
        actions.innerHTML =
          '<button type="button" class="primary" data-update-action="install" title="Retry the verified release download and installation.">Retry update</button><button type="button" class="secondary" data-update-action="later" title="Close this notice and try again after restarting Inkwell.">Later</button>';
        show();
      } finally {
        busy = false;
      }
    });
    if (desktop) {
      desktop.onProgress((status) => {
        if (status.phase !== 'error') installing(status);
      });
      setTimeout(() => check(false), 1400);
      setInterval(() => check(false), 6 * 60 * 60 * 1000);
    }
  }
  return { start, check };
})();
