#!/bin/sh
set -eu
ROOT="$HOME/.local/opt/inkwell"
[ -f "$ROOT/.inkwell-managed" ] || { echo 'No managed inkwell installation found.' >&2; exit 1; }
if [ "${1:-}" != '--yes' ]; then
  printf 'Close inkwell first. Remove the app but KEEP all mail/settings in ~/.inkwell? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes) ;; *) exit 0 ;; esac
fi
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
if [ -f "$ROOT/desktop-data-dir" ]; then IFS= read -r DATA < "$ROOT/desktop-data-dir"; fi
case "$DATA" in /*) ;; *) echo 'Invalid desktop data directory.' >&2; exit 1 ;; esac
if [ -f "$HOME/.local/bin/inkwell" ] && grep -q '^# Inkwell managed launcher$' "$HOME/.local/bin/inkwell"; then
  rm "$HOME/.local/bin/inkwell"
fi
if [ -f "$DATA/applications/inkwell.desktop" ] && grep -q '^X-Inkwell-Managed=true$' "$DATA/applications/inkwell.desktop"; then
  rm "$DATA/applications/inkwell.desktop"
fi
rm -f "$DATA/icons/hicolor/512x512/apps/inkwell.png"
rm -rf "$ROOT"
command -v update-desktop-database >/dev/null && update-desktop-database "$DATA/applications" || true
printf 'inkwell removed. Your ~/.inkwell workspace and Electron profile were preserved.\n'
