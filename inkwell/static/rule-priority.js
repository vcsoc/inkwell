'use strict';
window.InkwellRulePriority = (root, { rules, move, onError }) => {
  const mime = 'application/x-inkwell-rule';
  let source = null,
    busy = false;
  const clear = () =>
    root
      .querySelectorAll('.rule-drop-before,.rule-drop-after')
      .forEach((r) => r.classList.remove('rule-drop-before', 'rule-drop-after'));
  const finish = () => {
    source = null;
    clear();
  };
  const commit = async (id, target_id, placement) => {
    if (busy || id === target_id) return;
    busy = true;
    try {
      await move({ id, target_id, placement });
    } catch (error) {
      onError(error.message);
    } finally {
      busy = false;
      finish();
    }
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rule-up],[data-rule-down]');
    if (!b) return;
    const id = Number(b.dataset.ruleUp || b.dataset.ruleDown),
      index = rules().findIndex((r) => r.id === id),
      up = !!b.dataset.ruleUp,
      target = rules()[index + (up ? -1 : 1)];
    if (target) void commit(id, target.id, up ? 'before' : 'after');
  });
  root.addEventListener('dragstart', (e) => {
    const choice = e.target.closest('[data-edit-rule]');
    if (!choice || busy) {
      e.preventDefault();
      return;
    }
    source = Number(choice.dataset.editRule);
    e.dataTransfer.setData(mime, String(source));
    e.dataTransfer.effectAllowed = 'move';
  });
  const preview = (e) => {
    clear();
    if (!source || busy || !Array.from(e.dataTransfer?.types || []).includes(mime)) return null;
    const row = e.target.closest('[data-rule-entry]');
    if (!row || Number(row.dataset.ruleEntry) === source) return null;
    const placement =
      e.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
        ? 'before'
        : 'after';
    row.classList.add('rule-drop-' + placement);
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return { row, placement };
  };
  root.addEventListener('dragover', preview);
  root.addEventListener('drop', (e) => {
    const target = preview(e);
    if (target && e.dataTransfer.getData(mime) === String(source)) {
      const id = source;
      finish();
      void commit(id, Number(target.row.dataset.ruleEntry), target.placement);
    } else finish();
  });
  root.addEventListener('dragleave', (e) => {
    if (!root.contains(e.relatedTarget)) clear();
  });
  root.addEventListener('dragend', finish);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') finish();
  });
};
