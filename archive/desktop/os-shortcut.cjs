'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const DESCRIPTION = 'Inkwell (Super+I)';
const MARKER = '-- BEGIN Inkwell Super+I';
const BLOCK =
  '\n' +
  MARKER +
  '\nhl.unbind("SUPER + I")\no.bind("SUPER + I", "' +
  DESCRIPTION +
  '", { focus = "^inkwell$", launch = \'"$HOME/.local/bin/inkwell"\' })\n-- END Inkwell Super+I\n';
module.exports = ({
  home,
  run = promisify(execFile),
  omarchy = '/usr/share/omarchy',
  session = process.env.HYPRLAND_INSTANCE_SIGNATURE,
} = {}) => {
  const file = path.join(home, '.config/hypr/bindings.lua');
  let busy = false;
  const command = async (args) =>
    (await run('hyprctl', args, { timeout: 2500, maxBuffer: 2000000 })).stdout.trim();
  const bound = (b) =>
    Number(b.modmask) === 64 && (String(b.key).toLowerCase() === 'i' || Number(b.keycode) === 31);
  const inspect = async () => {
    if (process.platform !== 'linux' || !session)
      throw Error('This option requires an active Omarchy/Hyprland session.');
    await fs.access(path.join(omarchy, 'default/hypr'));
    await fs.access(path.join(home, '.local/bin/inkwell'), fs.constants.X_OK);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1000000)
      throw Error(
        'Bindings must be a regular user bindings.lua file under 1 MB; configure linked files manually.',
      );
    const bytes = await fs.readFile(file);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes))
      throw Error('Bindings must be UTF-8; configure this file manually.');
    const own = text.includes(BLOCK);
    if ((text.includes(MARKER) && !own) || text.split(MARKER).length > 2)
      throw Error('The Inkwell binding block was edited. Please review bindings.lua manually.');
    const bindings = JSON.parse(await command(['binds', '-j']));
    if (!Array.isArray(bindings)) throw Error('Could not inspect active Hyprland bindings.');
    const matches = bindings.filter(bound);
    const conflict = matches.find((b) => !own || b.description !== DESCRIPTION);
    return {
      text,
      mode: stat.mode & 0o777,
      own,
      active: matches.some((b) => b.description === DESCRIPTION),
      conflict: conflict
        ? String(conflict.description || conflict.dispatcher || 'another action')
        : null,
    };
  };
  const status = async () => {
    try {
      const s = await inspect();
      return { available: true, enabled: s.own, active: s.own && s.active, conflict: s.conflict };
    } catch (error) {
      return {
        available: false,
        enabled: false,
        error: error.code
          ? 'Omarchy user bindings and the installed Inkwell launcher are required.'
          : error.message,
      };
    }
  };
  const replace = async (text, mode) => {
    const temp = file + '.inkwell-' + process.pid + '-' + Date.now();
    try {
      await fs.writeFile(temp, text, { flag: 'wx', mode });
      await fs.rename(temp, file);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
  };
  const change = async (enabled) => {
    if (busy) throw Error('A shortcut change is already running.');
    busy = true;
    try {
      const s = await inspect();
      if (enabled && s.conflict)
        throw Error(
          'Super+I is already assigned to ' +
            s.conflict +
            '. Change that binding first; nothing was overwritten.',
        );
      if (enabled === s.own && (!enabled || s.active)) return status();
      const existingErrors = await command(['configerrors']);
      if (existingErrors)
        throw Error(
          'Hyprland already reports configuration errors. Fix them before changing this shortcut.',
        );
      const next = enabled ? (s.own ? s.text : s.text + BLOCK) : s.text.replace(BLOCK, '');
      const backup = file + '.bak.inkwell-' + Date.now() + '-' + randomUUID().slice(0, 8);
      await fs.writeFile(backup, s.text, { flag: 'wx', mode: 0o600 });
      if ((await fs.readFile(file, 'utf8')) !== s.text)
        throw Error('Bindings changed elsewhere; retry. No binding was overwritten.');
      await replace(next, s.mode);
      try {
        await command(['reload']);
        const errors = await command(['configerrors']);
        if (errors) throw Error('Hyprland rejected the shortcut configuration.');
        const after = await inspect();
        if (enabled && (!after.active || after.conflict))
          throw Error(
            'The shortcut was not activated; check that hyprland.lua loads hypr.bindings.',
          );
      } catch (error) {
        if ((await fs.readFile(file, 'utf8')) === next) {
          await replace(s.text, s.mode);
          try {
            await command(['reload']);
            if (await command(['configerrors'])) throw Error('Configuration errors remain.');
          } catch {
            throw Error(
              'Saved bindings restored, but reload could not be verified. Backup: ' + backup,
            );
          }
          throw Error(error.message + ' Previous bindings restored.');
        }
        throw Error(
          'Bindings changed elsewhere during reload; no rollback was forced. Backup: ' + backup,
        );
      }
      return { ...(await status()), backup };
    } finally {
      busy = false;
    }
  };
  return { status, change };
};
module.exports.BLOCK = BLOCK;
