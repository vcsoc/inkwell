'use strict';
window.InkwellMailAnalysis = {
  async mount(root, { api: request, esc, toast, isCurrent, openMail }) {
    const api = (url, method = 'GET', body) =>
      request(url, { method, ...(body === undefined ? {} : { body }) });
    let current = await api('/mail-analysis'),
      before = 0,
      busy = false;
    if (!root.isConnected || !isCurrent()) return;
    const selected = new Map();
    const help = (label, text) =>
      `<span class="analysis-help"><button type="button" aria-label="${esc(label)}">i</button><span role="tooltip">${esc(text)}</span></span>`;
    const toggle = (label, attrs = '') =>
      `<label class="analysis-toggle"><input type="checkbox" role="switch" aria-label="${esc(label)}" ${attrs}><span class="analysis-switch" aria-hidden="true"></span><span>${esc(label)}</span></label>`;
    root.innerHTML = `<section class="analysis-settings">
      <header class="analysis-heading"><div><h2>Local mail analysis</h2><span class="analysis-badge">Review only</span>${help('About local mail analysis', 'Experimental: strong scores can still be wrong. Select tags explicitly; there is no automatic application. Subject, sender and bounded text are analyzed locally, not attachments. Approved tags use provider synchronization.')}</div><div class="analysis-heading-controls"><label class="sr-only" for="analysis-model">Laya checkpoint</label><select id="analysis-model" name="model" form="analysis-config"><option value="english">English model</option><option value="multilingual">Multilingual · experimental</option></select>${toggle('Background analysis', 'id="analysis-enabled" name="enabled" form="analysis-config"')}</div></header>
      <div id="analysis-page-error" class="analysis-alert" role="status" hidden></div>
      <div class="analysis-overview"><section class="analysis-panel analysis-usage"><div class="analysis-panel-heading"><h3>Tag usage</h3><span id="analysis-usage-total"></span>${help('About tag usage', 'Actual tagged-message counts across the cached mailbox, including manually applied tags. A message can have several tags; totals are tag assignments, not unique messages.')}</div><div id="analysis-usage-chart" role="list" aria-label="Tag usage totals"></div></section>
      <section class="analysis-panel analysis-queue"><div class="analysis-panel-heading"><h3>Analysis progress</h3><span id="analysis-queue-state" class="analysis-badge"></span>${help('About analysis progress', 'Backfill progress counts eligible messages, not database IDs. Completed means analysis finished, not tags applied. Pause stops queued backfill after the current batch; incoming mail can continue. Enabling background analysis does not start a backfill.')}</div><div id="analysis-progress-label"></div><progress id="analysis-progress" max="100" value="0" aria-label="Mail analysis progress"></progress><p id="analysis-status" class="analysis-progress-detail" role="status"></p><div id="analysis-metrics"></div><p id="analysis-error" class="analysis-alert" role="status" hidden></p><div class="analysis-queue-actions"><button type="button" id="analysis-backfill">Analyze existing mail</button><button type="button" id="analysis-pause">Pause backfill</button><button type="button" id="analysis-resume">Resume backfill</button><button type="button" id="analysis-retry">Retry failed analysis</button></div></section></div>
      <nav class="analysis-tabs" aria-label="Mail analysis views"><button type="button" id="analysis-review-tab" aria-pressed="true">Review queue <span id="analysis-review-count"></span></button><button type="button" id="analysis-catalog-tab" aria-pressed="false">Tag catalog <span id="analysis-category-count"></span></button><span id="analysis-runtime"></span>${help('Local runtime details', 'Models load only for queued work in a separate CPU process, with one checkpoint and bounded batches. The process exits after each batch. First use may download weights. Multilingual scores need independent validation.')}</nav>
      <section id="analysis-review-panel"><div class="analysis-review-toolbar"><label for="analysis-filter">Results</label><select id="analysis-filter"><option value="review">Awaiting review</option><option value="no_match">Below thresholds</option><option value="applied">Applied</option><option value="failed">Failed</option><option value="rejected">Dismissed</option></select>${help('Selecting scored tags', 'Every scored tag is selectable, even below its threshold. Highlighted tags meet the model threshold; scores are not accuracy percentages. Choosing a lower-scored tag is an explicit manual decision. Existing tags are preserved.')}<button type="button" id="analysis-refresh">Refresh results</button></div><div id="analysis-results" aria-live="polite"></div><div class="analysis-pagination"><button type="button" id="analysis-newest">Newest results</button><button type="button" id="analysis-older">Older results</button></div></section>
      <section id="analysis-catalog-panel" hidden><form id="analysis-config"><div class="analysis-catalog-toolbar"><div><h3>Tag catalog</h3><span id="analysis-catalog-state" role="status">Changes save together</span>${help('Editing the tag catalog', 'Add, edit or remove analysis definitions here, then save. Removing a definition does not remove tags already on messages or delete provider categories. Up to 50 analysis definitions; each message can still have at most 12 tags. Saving changed definitions invalidates old unapplied analysis. Use a short yes/no question as the description.')}</div><button type="button" id="analysis-add-tag">Add tag</button><button class="primary" type="submit" id="analysis-save">Save analysis settings</button></div><div class="analysis-table-scroll"><table class="analysis-catalog-table"><caption class="sr-only">Editable analysis tag definitions</caption><thead><tr><th scope="col">Enabled</th><th scope="col">Tag name</th><th scope="col">Description / question</th><th scope="col">Threshold</th><th scope="col">Usage</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody id="analysis-categories"></tbody></table></div><p id="analysis-catalog-error" class="analysis-alert" role="status" hidden></p></form></section>
    </section>`;
    const form = root.querySelector('#analysis-config'),
      results = root.querySelector('#analysis-results'),
      master = root.querySelector('#analysis-enabled'),
      model = root.querySelector('#analysis-model');
    master.checked = current.config.enabled;
    model.value = current.config.model || 'english';
    const positionHelp = (event) => {
      const anchor = event.target.closest('.analysis-help');
      if (!anchor) return;
      delete anchor.dataset.dismissed;
      const tip = anchor.querySelector('[role=tooltip]'),
        zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      tip.style.position = 'fixed';
      tip.style.right = 'auto';
      tip.style.maxWidth = Math.max(40, (innerWidth - 24) / zoom) + 'px';
      const box = anchor.getBoundingClientRect(),
        size = tip.getBoundingClientRect();
      tip.style.left = Math.max(12, Math.min(box.left, innerWidth - size.width - 12)) / zoom + 'px';
      tip.style.top =
        Math.max(
          12,
          box.bottom + size.height + 8 > innerHeight - 12
            ? box.top - size.height - 8
            : box.bottom + 8,
        ) /
          zoom +
        'px';
    };
    root.addEventListener('pointerover', positionHelp);
    root.addEventListener('focusin', positionHelp);
    root.addEventListener('keydown', (event) => {
      const anchor = event.target.closest('.analysis-help');
      if (event.key === 'Escape' && anchor) {
        anchor.dataset.dismissed = 'true';
        event.preventDefault();
      }
    });
    const fail = (error) => {
      const el = root.querySelector('#analysis-page-error');
      el.hidden = false;
      el.textContent = error.message || 'Mail analysis request failed';
    };
    const usageFor = (name) =>
      (current.tag_usage || []).find((item) => item.name.toLowerCase() === name.toLowerCase())
        ?.count || 0;
    const markDirty = () => {
      root.querySelector('#analysis-catalog-state').textContent = 'Unsaved changes';
    };
    const addRow = (c = { name: '', description: '', threshold: 0.8, enabled: true }) => {
      const row = document.createElement('tr');
      row.dataset.category = '';
      row.innerHTML = `<td>${toggle('Enable tag ' + (c.name || 'definition'), `data-field="enabled" ${c.enabled ? 'checked' : ''}`)}</td><td><input data-field="name" aria-label="Tag name" value="${esc(c.name)}" maxlength="32" placeholder="New tag" required></td><td><textarea data-field="description" aria-label="Tag description" rows="2" minlength="10" maxlength="1000" placeholder="Does this email …?" required>${esc(c.description)}</textarea></td><td><input data-field="threshold" aria-label="Minimum model score" type="number" min="0.5" max="1" step="0.01" value="${c.threshold}" required></td><td class="analysis-row-usage">${usageFor(c.name)}</td><td><button type="button" class="analysis-remove" aria-label="Remove ${esc(c.name || 'tag definition')}">Remove</button></td>`;
      row.querySelector('.analysis-remove').onclick = () => {
        row.remove();
        markDirty();
      };
      row.oninput = () => {
        markDirty();
        const name = row.querySelector('[data-field=name]').value || 'tag definition';
        row.querySelector('.analysis-remove').setAttribute('aria-label', 'Remove ' + name);
        row.querySelector('[data-field=enabled]').setAttribute('aria-label', 'Enable tag ' + name);
      };
      row.onchange = markDirty;
      root.querySelector('#analysis-categories').append(row);
      // The first column is a compact control; its accessible name remains descriptive.
      row.querySelector('.analysis-toggle > span:last-child').classList.add('sr-only');
      return row;
    };
    current.config.categories.forEach(addRow);
    const tab = (catalog) => {
      root.querySelector('#analysis-catalog-panel').hidden = !catalog;
      root.querySelector('#analysis-review-panel').hidden = catalog;
      root.querySelector('#analysis-catalog-tab').setAttribute('aria-pressed', String(catalog));
      root.querySelector('#analysis-review-tab').setAttribute('aria-pressed', String(!catalog));
    };
    root.querySelector('#analysis-catalog-tab').onclick = () => tab(true);
    root.querySelector('#analysis-review-tab').onclick = () => tab(false);
    root.querySelector('#analysis-add-tag').onclick = () => {
      if (root.querySelectorAll('[data-category]').length >= 50) {
        fail(new Error('The analysis catalog supports at most 50 tags.'));
        return;
      }
      const row = addRow();
      markDirty();
      row.querySelector('[data-field=name]').focus();
    };

    const showStatus = () => {
      const counts = current.counts,
        fill = current.backfill || {},
        p = current.progress;
      const complete = ['review', 'no_match', 'applied', 'rejected'].reduce(
          (sum, key) => sum + (counts[key] || 0),
          0,
        ),
        waiting = (counts.pending || 0) + (counts.running || 0) + (counts.failed || 0);
      const snapshot = fill.through !== undefined && p;
      const total = snapshot ? p.total : complete + waiting,
        done = snapshot ? p.completed : complete,
        left = snapshot ? p.remaining : waiting;
      const percent = total ? Math.min(100, (100 * done) / total) : 0;
      root.querySelector('#analysis-progress').value = percent;
      root.querySelector('#analysis-progress-label').innerHTML = total
        ? `<strong>${done.toLocaleString()} <small>/ ${total.toLocaleString()}</small></strong><span>${Math.round(percent)}% ${snapshot ? 'backfill analyzed' : 'analyzed'}</span>`
        : '<strong>No mail queued</strong><span>Ready when you are</span>';
      root.querySelector('#analysis-status').textContent =
        `${left.toLocaleString()} remaining${snapshot ? ' · ' + p.unqueued.toLocaleString() + ' not yet queued' : ''} · ${counts.pending || 0} queued · ${counts.running || 0} running`;
      const state = current.last_error
        ? 'Needs attention'
        : !current.config.enabled
          ? 'Off'
          : fill.paused
            ? 'Backfill paused'
            : current.worker_active
              ? 'Analyzing'
              : fill.active
                ? 'Scanning'
                : left
                  ? 'Waiting'
                  : 'Up to date';
      root.querySelector('#analysis-queue-state').textContent = state;
      root.querySelector('#analysis-metrics').innerHTML = [
        ['Awaiting review', counts.review || 0],
        ['Below thresholds', counts.no_match || 0],
        ['Applied', counts.applied || 0],
        ['Failed', counts.failed || 0],
      ]
        .map(
          ([label, value]) =>
            `<div><strong>${value.toLocaleString()}</strong><span>${label}</span></div>`,
        )
        .join('');
      const error = root.querySelector('#analysis-error');
      error.hidden = !current.last_error;
      error.textContent = current.last_error ? 'Analysis paused: ' + current.last_error : '';
      root.querySelector('#analysis-backfill').disabled =
        !current.config.enabled || !!fill.active || !!current.backfill_pending;
      root.querySelector('#analysis-pause').disabled =
        !!fill.paused || (!fill.active && !current.backfill_pending);
      root.querySelector('#analysis-resume').disabled =
        !current.config.enabled || !fill.paused || fill.through === undefined;
      root.querySelector('#analysis-retry').disabled = !counts.failed && !current.last_error;
      root.querySelector('#analysis-review-count').textContent = counts.review || 0;
      root.querySelector('#analysis-category-count').textContent = current.config.categories.length;
      const runtime = root.querySelector('#analysis-runtime');
      runtime.textContent = current.runtime_ready ? 'Local CPU · runtime ready' : 'Runtime missing';
      runtime.title = current.runtime_ready
        ? 'One checkpoint, loaded on demand; no resident model while idle.'
        : 'Install Laya at ' + current.runtime_path + '. See docs/MAIL-ANALYSIS.md for setup.';
      const usage =
          current.tag_usage || current.config.categories.map((c) => ({ name: c.name, count: 0 })),
        max = Math.max(1, ...usage.map((c) => c.count));
      root.querySelector('#analysis-usage-total').textContent =
        usage.reduce((sum, c) => sum + c.count, 0).toLocaleString() + ' assignments';
      root.querySelector('#analysis-usage-chart').innerHTML = usage.length
        ? usage
            .map(
              (c) =>
                `<div class="analysis-bar" role="listitem"><span title="${esc(c.name)}">${esc(c.name)}</span><meter aria-label="${esc(c.name)} usage" min="0" max="${max}" value="${c.count}"></meter><strong>${c.count.toLocaleString()}</strong></div>`,
            )
            .join('')
        : '<p class="analysis-empty">Add a tag definition to get started.</p>';
      for (const row of root.querySelectorAll('[data-category]'))
        row.querySelector('.analysis-row-usage').textContent = usageFor(
          row.querySelector('[data-field=name]').value,
        );
    };
    const renderResults = async () => {
      const items = await api(
        '/mail-analysis/results?state=' +
          root.querySelector('#analysis-filter').value +
          '&before=' +
          before,
      );
      if (!root.isConnected || !isCurrent()) return;
      results.innerHTML = items.length
        ? items
            .map((item) => {
              const reviewable = ['review', 'no_match'].includes(item.state),
                choices = current.config.categories.filter(
                  (c) => typeof item.scores[c.name] === 'number',
                );
              const picked = selected.get(item.message_id) || new Set();
              const sync = item.provider_job_id
                ? item.sync_state === 'done'
                  ? 'Provider synchronized'
                  : item.sync_state === 'failed'
                    ? 'Provider synchronization failed: ' + item.sync_error
                    : item.sync_state === 'cancelled'
                      ? 'Provider synchronization cancelled; not synchronized'
                      : item.sync_state
                        ? 'Provider synchronization ' + item.sync_state
                        : 'Provider synchronization status unavailable'
                : item.outcome;
              const date = new Date(item.date),
                dateLabel = Number.isNaN(date.getTime())
                  ? item.date
                  : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
              return `<article class="analysis-result" data-analysis-id="${item.message_id}"><header><div><h4>${esc(item.subject || '(No subject)')}</h4><p>${esc(item.sender)} · ${esc(dateLabel)}</p></div><button type="button" data-open-mail="${item.message_id}">View message</button></header><div class="analysis-existing"><span>Existing tags</span>${item.tags.length ? item.tags.map((t) => `<span class="analysis-tag-pill">${esc(t)}</span>`).join('') : '<small>None</small>'}${item.truncated ? help('Shortened message', 'This long message was shortened for analysis. Check the full email before choosing tags.') : ''}</div><p class="analysis-result-error analysis-alert" role="status" ${item.error ? '' : 'hidden'}>${esc(item.error || '')}</p>${
                reviewable
                  ? `<form data-review="${item.message_id}"><div class="analysis-suggestions">${choices
                      .map((c) => {
                        const score = item.scores[c.name],
                          suggested = score >= c.threshold;
                        return `<label class="analysis-toggle analysis-tag-choice ${suggested ? 'suggested' : ''}" title="${esc(c.name)} · model score ${score.toFixed(2)} · ${suggested ? 'meets' : 'below'} threshold ${c.threshold.toFixed(2)}. You can select any scored tag."><input type="checkbox" role="switch" aria-label="${esc(c.name)}" name="tags" value="${esc(c.name)}" ${picked.has(c.name) ? 'checked' : ''}><span class="analysis-switch" aria-hidden="true"></span><span>${esc(c.name)}<small>${suggested ? 'Suggested' : 'Manual choice'}</small></span><strong>${score.toFixed(2)}</strong></label>`;
                      })
                      .join(
                        '',
                      )}</div><footer><span class="analysis-selection-count">${picked.size} selected</span><button type="button" data-dismiss="${item.message_id}" aria-label="Dismiss suggestions">Dismiss</button><button class="primary" type="submit" aria-label="Apply selected tags" ${picked.size ? '' : 'disabled'}>Apply selected tags</button></footer></form>`
                  : `<p class="analysis-sync-state">${esc(sync || item.state)}</p>`
              }</article>`;
            })
            .join('')
        : '<div class="analysis-empty"><strong>No results in this view</strong><p>New analysis appears here as the queue is processed.</p></div>';
      root.querySelector('#analysis-older').disabled = items.length < 50;
      root.querySelector('#analysis-newest').disabled = !before;
      root.querySelector('#analysis-older').onclick = () => {
        before = items.at(-1)?.message_id || 0;
        selected.clear();
        refresh().catch(fail);
      };
      for (const button of results.querySelectorAll('[data-open-mail]'))
        button.onclick = () => openMail(Number(button.dataset.openMail)).catch(fail);
      for (const review of results.querySelectorAll('[data-review]')) {
        const id = Number(review.dataset.review);
        review.onchange = () => {
          const values = new Set(new FormData(review).getAll('tags'));
          if (values.size) selected.set(id, values);
          else selected.delete(id);
          review.querySelector('[type=submit]').disabled = !values.size || values.size > 12;
          review.querySelector('.analysis-selection-count').textContent =
            values.size + (values.size > 12 ? ' selected · limit 12' : ' selected');
        };
        review.onsubmit = async (event) => {
          event.preventDefault();
          if (busy) return;
          busy = true;
          const button = review.querySelector('[type=submit]');
          button.disabled = true;
          try {
            const outcome = await api('/mail-analysis/' + id + '/approve', 'POST', {
              tags: new FormData(review).getAll('tags'),
            });
            selected.delete(id);
            await refresh();
            toast(
              outcome.provider_queued
                ? 'Tags applied; provider synchronization pending.'
                : 'Tags saved. No new provider operation was needed.',
            );
          } catch (error) {
            const el = review.closest('article').querySelector('.analysis-result-error');
            el.hidden = false;
            el.textContent = error.message;
          } finally {
            busy = false;
            if (button.isConnected) button.disabled = !review.querySelector('[name=tags]:checked');
          }
        };
      }
      for (const button of results.querySelectorAll('[data-dismiss]'))
        button.onclick = async () => {
          try {
            await api('/mail-analysis/' + button.dataset.dismiss + '/reject', 'POST');
            selected.delete(Number(button.dataset.dismiss));
            await refresh();
          } catch (error) {
            fail(error);
          }
        };
    };
    const refresh = async (includeResults = true) => {
      current = await api('/mail-analysis');
      if (!root.isConnected || !isCurrent()) return;
      showStatus();
      if (includeResults) await renderResults();
    };
    const configBusy = (value) => {
      for (const control of [master, model, root.querySelector('#analysis-save')])
        control.disabled = value;
    };
    master.onchange = async () => {
      configBusy(true);
      try {
        current = await api('/mail-analysis', 'PUT', {
          ...current.config,
          enabled: master.checked,
        });
        showStatus();
      } catch (error) {
        master.checked = current.config.enabled;
        fail(error);
      } finally {
        configBusy(false);
      }
    };
    model.onchange = async () => {
      configBusy(true);
      try {
        current = await api('/mail-analysis', 'PUT', { ...current.config, model: model.value });
        selected.clear();
        await refresh();
      } catch (error) {
        model.value = current.config.model;
        fail(error);
      } finally {
        configBusy(false);
      }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      configBusy(true);
      const errorBox = root.querySelector('#analysis-catalog-error');
      errorBox.hidden = true;
      try {
        const categories = [...root.querySelectorAll('[data-category]')].map((row) => ({
          name: row.querySelector('[data-field=name]').value,
          description: row.querySelector('[data-field=description]').value,
          threshold: Number(row.querySelector('[data-field=threshold]').value),
          enabled: row.querySelector('[data-field=enabled]').checked,
        }));
        current = await api('/mail-analysis', 'PUT', {
          enabled: master.checked,
          model: model.value,
          categories,
        });
        selected.clear();
        root.querySelector('#analysis-categories').replaceChildren();
        current.config.categories.forEach(addRow);
        root.querySelector('#analysis-catalog-state').textContent = 'All changes saved';
        await refresh();
        toast('Analysis catalog saved. Existing message tags are unchanged.');
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error.message;
      } finally {
        configBusy(false);
      }
    };
    for (const [id, action] of [
      ['analysis-backfill', 'start'],
      ['analysis-pause', 'pause'],
      ['analysis-resume', 'resume'],
    ])
      root.querySelector('#' + id).onclick = async () => {
        try {
          await api('/mail-analysis/backfill', 'POST', { action });
          await refresh();
        } catch (error) {
          fail(error);
        }
      };
    root.querySelector('#analysis-retry').onclick = async () => {
      try {
        await api('/mail-analysis/retry', 'POST');
        await refresh();
      } catch (error) {
        fail(error);
      }
    };
    root.querySelector('#analysis-filter').onchange = () => {
      before = 0;
      selected.clear();
      refresh().catch(fail);
    };
    root.querySelector('#analysis-newest').onclick = () => {
      before = 0;
      selected.clear();
      refresh().catch(fail);
    };
    root.querySelector('#analysis-refresh').onclick = () => refresh().catch(fail);
    await refresh();
    const timer = setInterval(() => {
      if (!root.isConnected || !isCurrent()) {
        clearInterval(timer);
        return;
      }
      refresh(!busy && !selected.size && !results.contains(document.activeElement)).catch(fail);
    }, 5000);
  },
};
