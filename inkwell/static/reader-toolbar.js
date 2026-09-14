'use strict';
window.InkwellReaderToolbar = (message, dark, canNotJunk = true) => {
  const paths = {
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
    reply: '<path d="m9 5-6 6 6 6M3 11h10a8 8 0 0 1 8 8"/>',
    forward: '<path d="m15 5 6 6-6 6M21 11H11a8 8 0 0 0-8 8"/>',
    safe: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
    archive: '<path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/>',
    inbox: '<path d="m3 13 3-9h12l3 9v7H3zM3 13h5l2 3h4l2-3h5"/>',
    restore: '<path d="M3 10a9 9 0 1 1 2 9M3 4v6h6"/>',
    unread: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    move: '<path d="M20 8V6H10L8 3H3v17h17v-4M12 12h10m-4-4 4 4-4 4"/>',
    tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1"/>',
    save: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    contact: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M19 6v8m-4-4h8"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  };
  const button = (id, icon, label, title = label, extra = '') =>
    `<button type="button" class="secondary reader-tool ${icon === 'trash' ? 'danger' : ''}" id="${id}" aria-label="${title}" title="${id === 'reader-not-junk' ? 'Refile all incoming copies from this sender and remember future imports' : title}" ${extra}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[icon]}</svg><span>${label}</span></button>`;
  return `<div class="reader-actions" role="group" aria-label="Email actions">${button('reader-back', 'back', 'Back', 'Back to messages')}${button('reply', 'reply', 'Reply')}${button('forward', 'forward', 'Forward')}${button('archive-message', message.folder === 'trash' ? 'restore' : message.folder === 'archive' ? 'inbox' : 'archive', message.folder === 'trash' ? 'Restore' : message.folder === 'archive' ? 'Inbox' : 'Archive', message.folder === 'trash' ? 'Restore' : message.folder === 'archive' ? 'Move to inbox' : 'Archive')}${button('unread-message', 'unread', 'Unread', 'Mark unread')}${button('reader-star', 'star', message.starred ? 'Unstar' : 'Star', message.starred ? 'Unstar message' : 'Star message', `aria-pressed="${!!message.starred}"`)}${button('reader-move', 'move', 'Move', 'Move local copy')}${button('reader-not-junk', 'safe', 'Not Junk', 'Not Junk', canNotJunk ? '' : 'disabled')}${button('edit-tags', 'tag', 'Tags', 'Tags…')}${button('reader-save', 'save', 'Save text', 'Save message as text')}${button('reader-contact', 'contact', 'Contact', 'Add sender to contacts')}${button('reader-copy', 'copy', 'Copy address', 'Copy sender address')}${button('reader-appearance', dark ? 'sun' : 'moon', dark ? 'Light view' : 'Dark view', `Switch reader to ${dark ? 'light' : 'dark'} view`)}${button('trash-message', 'trash', message.folder === 'trash' ? 'Delete' : 'Trash', message.folder === 'trash' ? 'Permanently delete' : 'Move to trash')}${button('reader-menu', 'more', 'More', 'More email actions', 'aria-haspopup="menu" aria-expanded="false"')}</div>`;
};
