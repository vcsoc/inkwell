'use strict';
window.InkwellComposeQuote = (message, action) => {
  // Normalize imported/previously quoted padding, never text typed into a draft.
  const lines = String(message.body || '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const compact = [];
  for (const line of lines) {
    const blank = /^[\s>\u200b]*$/u.test(line);
    if (blank) {
      if (compact.length && compact.at(-1) !== '') compact.push('');
    } else compact.push(line);
  }
  if (compact.at(-1) === '') compact.pop();
  const body = compact.join('\n'),
    subject = message.subject || '',
    sender = message.sender || '';
  if (action === 'forward')
    return {
      compose_action: action,
      account_id: message.account_id,
      subject: /^fw(?:d)?:/i.test(subject) ? subject : 'Fwd: ' + subject,
      body:
        '\n---------- Forwarded message ----------\nFrom: ' +
        sender +
        '\nSubject: ' +
        subject +
        (body ? '\n\n' + body : ''),
    };
  const date = new Date(message.date),
    when = Number.isNaN(date.getTime()) ? '' : 'On ' + date.toLocaleString() + ', ';
  return {
    compose_action: 'reply',
    account_id: message.account_id,
    recipient: sender.match(/<([^>]+)>/)?.[1] || sender,
    subject: /^re:/i.test(subject) ? subject : 'Re: ' + subject,
    body:
      '\n' +
      when +
      sender +
      ' wrote:' +
      (body ? '\n' + compact.map((line) => (line ? '> ' + line : '')).join('\n') : ''),
  };
};
