'use strict';
// Deliberately restricted YAML: theme mappings/scalars only, no tags, aliases or execution.
window.InkwellThemeFiles = (() => {
  function scalar(text) {
    text = text.trim();
    if (text.startsWith('"')) {
      const match = text.match(/^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/);
      if (!match) throw Error('Invalid quoted YAML value');
      return JSON.parse(match[1]);
    }
    if (text.startsWith("'")) {
      const match = text.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
      if (!match) throw Error('Invalid quoted YAML value');
      return match[1].replaceAll("''", "'");
    }
    text = text.replace(/\s+#.*$/, '').trim();
    if (!text || /^[#&*!>|\[\]{}]/.test(text) || /:\s/.test(text))
      throw Error('Use simple YAML values; quote hex colors. Tags and aliases are not supported.');
    if (/^-?\d+$/.test(text)) return Number(text);
    if (text === 'true' || text === 'false') return text === 'true';
    return text;
  }
  function parse(text) {
    if (text.length > 16000) throw Error('Theme files must be smaller than 16 KB');
    text = text.replace(/^\uFEFF/, '');
    if (text.trimStart().startsWith('{')) return JSON.parse(text);
    const result = Object.create(null),
      theme = Object.create(null);
    let inTheme = false,
      indent = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || /^\s*#/.test(line) || line.trim() === '---') continue;
      if (line.includes('\t')) throw Error('Use spaces for YAML indentation');
      const match = line.match(/^( *)([a-z_]+):\s*(.*?)\s*$/);
      if (!match) throw Error('Expected a simple YAML theme mapping');
      const [, spaces, key, value] = match;
      if (!spaces.length) {
        if (!['version', 'theme'].includes(key) || Object.hasOwn(result, key))
          throw Error('Unknown or duplicate YAML property');
        inTheme = key === 'theme';
        if (inTheme) {
          if (value && !value.startsWith('#')) throw Error('Theme must be an indented mapping');
          result.theme = theme;
        } else result.version = scalar(value);
      } else {
        if (!inTheme || (indent !== null && indent !== spaces.length) || Object.hasOwn(theme, key))
          throw Error('Invalid indentation or duplicate theme property');
        indent = spaces.length;
        theme[key] = scalar(value);
      }
    }
    return result;
  }
  function stringify(theme, format = 'yaml') {
    return format === 'json'
      ? JSON.stringify({ version: 1, theme }, null, 2)
      : '# inkwell theme — colors must be quoted\nversion: 1\ntheme:\n' +
          Object.entries(theme)
            .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
            .join('\n') +
          '\n';
  }
  return { parse, stringify };
})();
