'use strict';
window.InkwellComposerLayout = (form, state) => {
  const dialog = form.closest('dialog'),
    main = document.querySelector('main'),
    workspace = document.querySelector('#workspace');
  if (
    !workspace ||
    (document.documentElement.dataset.mail !== 'true' && !workspace.querySelector('.message-list'))
  )
    return;
  const root = document.documentElement,
    inline = dialog.classList.contains('inline-form');
  let wrapper;
  if (inline) {
    wrapper = document.createElement('div');
    wrapper.id = 'mail-compose-layout';
    workspace.before(wrapper);
    wrapper.append(workspace, dialog);
  }
  const update = () => {
    if (!form.isConnected || !dialog.open) return;
    // Use the actual available logical width, including application zoom/sidebar.
    const available = main.clientWidth;
    if (available < 960 || !workspace.querySelector('.message-list')) {
      delete root.dataset.composeSplit;
      return;
    }
    root.dataset.composeSplit = inline ? 'inline' : 'popup';
    const list = Math.min(400, Math.max(280, Math.round(available * 0.3)));
    root.style.setProperty('--compose-list-width', list + 'px');
    if (!inline) {
      const zoom = Number.parseFloat(getComputedStyle(root).zoom) || 1,
        box = workspace.getBoundingClientRect();
      root.style.setProperty('--compose-dock-width', available - list + 'px');
      root.style.setProperty('--compose-dock-top', box.top / zoom + 'px');
      const footer = document.querySelector('#app-footer')?.getBoundingClientRect().height || 0;
      const tabs = document.querySelector('.mobile-tabs')?.getBoundingClientRect().height || 0;
      root.style.setProperty(
        '--compose-dock-height',
        Math.max(300, (window.innerHeight - box.top - footer - tabs) / zoom) + 'px',
      );
    }
  };
  const observer = new ResizeObserver(update);
  observer.observe(main);
  observer.observe(workspace);
  const contentObserver = new MutationObserver(update);
  contentObserver.observe(workspace, { childList: true });
  window.addEventListener('resize', update);
  update();
  const previousCleanup = state.formCleanup;
  state.formCleanup = () => {
    observer.disconnect();
    contentObserver.disconnect();
    window.removeEventListener('resize', update);
    delete root.dataset.composeSplit;
    for (const name of [
      '--compose-list-width',
      '--compose-dock-width',
      '--compose-dock-top',
      '--compose-dock-height',
    ])
      root.style.removeProperty(name);
    if (wrapper) {
      wrapper.before(workspace);
      document.body.append(dialog);
      wrapper.remove();
    }
    previousCleanup?.();
  };
};
