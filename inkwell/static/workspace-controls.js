'use strict';
window.InkwellWorkspaceControls = (getPreferences, save) => {
  // CSS zoom scales fixed-size text, but not viewport units or media thresholds.
  // Keep viewport-filling panes and responsive breakpoints in the same logical space.
  const mediaRules = [],
    viewportRules = [];
  function collect(rules) {
    for (const rule of rules) {
      if (rule.media) mediaRules.push([rule, rule.media.mediaText]);
      if (rule.style)
        for (const property of rule.style) {
          const value = rule.style.getPropertyValue(property);
          if (/\d+(?:\.\d+)?(?:d?vh|vw)\b/.test(value))
            viewportRules.push([
              rule.style,
              property,
              value,
              rule.style.getPropertyPriority(property),
            ]);
        }
      if (rule.cssRules) collect(rule.cssRules);
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      collect(sheet.cssRules);
    } catch {
      /* Ignore browser-injected cross-origin sheets. */
    }
  }
  let appliedScale;
  function scaleLayout() {
    const scale = (getPreferences().ui_zoom || 100) / 100;
    if (scale === appliedScale) return;
    appliedScale = scale;
    for (const [rule, original] of mediaRules)
      rule.media.mediaText =
        scale === 1
          ? original
          : original.replace(
              /((?:min|max)-(?:width|height):\s*)(\d+(?:\.\d+)?)px/g,
              (_match, prefix, size) =>
                prefix + Math.round(Number(size) * scale * 1000) / 1000 + 'px',
            );
    for (const [style, property, original, priority] of viewportRules)
      style.setProperty(
        property,
        scale === 1
          ? original
          : original.replace(/(\d+(?:\.\d+)?(?:d?vh|vw))\b/g, 'calc($1 / ' + scale + ')'),
        priority,
      );
  }
  function bind(element, key, min, max) {
    if (!element || element.dataset.bound) return;
    element.dataset.bound = 'true';
    const update = (value) => {
      value = Math.max(min, Math.min(max, Math.round(value)));
      element.setAttribute('aria-valuenow', value);
      save({ [key]: value });
    };
    element.setAttribute('aria-valuemin', min);
    element.setAttribute('aria-valuemax', max);
    element.setAttribute(
      'aria-valuenow',
      getPreferences()[key] || (key === 'sidebar_width' ? 260 : 380),
    );
    const renderedWidth = () =>
      (key === 'sidebar_width'
        ? element.parentElement
        : element.previousElementSibling
      ).getBoundingClientRect().width / (getPreferences().ui_zoom / 100 || 1);
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      const start = event.clientX,
        width = renderedWidth();
      const move = (e) =>
        update(width + (e.clientX - start) / (getPreferences().ui_zoom / 100 || 1));
      const stop = () => {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', stop);
        element.removeEventListener('pointercancel', stop);
      };
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', stop);
      element.addEventListener('pointercancel', stop);
    });
    element.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      update(
        event.key === 'Home'
          ? min
          : event.key === 'End'
            ? max
            : renderedWidth() + (event.key === 'ArrowLeft' ? -10 : 10),
      );
    });
  }
  window.InkwellAdjustZoom = (delta) => {
    const value = delta === 0 ? 100 : (getPreferences().ui_zoom || 100) + delta;
    save({ ui_zoom: Math.max(75, Math.min(175, value)) });
  };
  document.addEventListener('keydown', (event) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      !['+', '=', '-', '0'].includes(event.key)
    )
      return;
    event.preventDefault();
    window.InkwellAdjustZoom(event.key === '0' ? 0 : event.key === '-' ? -10 : 10);
  });
  return () => {
    scaleLayout();
    bind(document.querySelector('#sidebar-resizer'), 'sidebar_width', 180, 480);
    bind(document.querySelector('#message-resizer'), 'message_list_width', 220, 900);
  };
};
