#!/usr/bin/env bash
set -euo pipefail

project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
app=$(realpath -- "${1:?Usage: scripts/install-linux.sh /path/to/built/inkwell-tauri}")
version=$(awk -F '"' '/^version = / {print $2; exit}' "$project/src-tauri/Cargo.toml")
[[ -x "$app" && "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ ]]
case "$HOME" in
  *[!a-zA-Z0-9_./\ -]*) printf '%s\n' 'Unsupported home path for the desktop launcher.' >&2; exit 1 ;;
esac

root="$HOME/.local/opt/inkwellr"
launcher="$HOME/.local/bin/inkwellr"
entry="$HOME/.local/share/applications/inkwellr.desktop"
marker='inkwellr-managed-install'

for existing in "$launcher" "$entry"; do
  if [[ -e "$existing" || -L "$existing" ]]; then
    if [[ -L "$existing" ]] || ! grep -Fq -- "$marker" "$existing"; then
      printf 'Refusing to replace unmanaged file: %s\n' "$existing" >&2
      exit 1
    fi
  fi
done
if [[ -e "$root" || -L "$root" ]]; then
  [[ -d "$root" && ! -L "$root" && -f "$root/.$marker" ]] || {
    printf 'Refusing to use unmanaged directory: %s\n' "$root" >&2; exit 1;
  }
else
  mkdir -p -- "$(dirname -- "$root")"
  mkdir -- "$root"
  touch -- "$root/.$marker"
fi
mkdir -p -- "$root/releases" "$(dirname -- "$launcher")" "$(dirname -- "$entry")"
release=$(mktemp -d "$root/releases/$version.XXXXXX")
tmp_launcher=$(mktemp "$launcher.XXXXXX")
tmp_entry=$(mktemp "${entry%.desktop}.XXXXXX.desktop")
tmp_link="$root/.current-${release##*/}"
trap 'rm -f -- "$tmp_launcher" "$tmp_entry" "$tmp_link"' EXIT
install -m 755 -- "$app" "$release/inkwellr"
install -m 644 -- "$project/src-tauri/icons/icon.png" "$release/icon.png"
printf '%s\n' "$version" > "$release/version"
printf '%s\n' '#!/usr/bin/env sh' "# $marker" 'exec "$HOME/.local/opt/inkwellr/current/inkwellr" "$@"' > "$tmp_launcher"
chmod 755 -- "$tmp_launcher"
printf '%s\n' '[Desktop Entry]' "# $marker" 'Type=Application' > "$tmp_entry"
printf 'Name=inkwell\302\256\n' >> "$tmp_entry"
printf '%s\n' 'GenericName=Mail and Calendar' 'Comment=Rust/Tauri desktop preview for your Inkwell workspace' "Exec=\"$launcher\"" "Icon=$root/current/icon.png" 'Categories=Network;Email;' 'Terminal=false' 'StartupWMClass=inkwellr' >> "$tmp_entry"
if command -v desktop-file-validate >/dev/null; then desktop-file-validate "$tmp_entry"; fi
ln -s -- "releases/${release##*/}" "$tmp_link"
mv -Tf -- "$tmp_link" "$root/current"
mv -Tf -- "$tmp_launcher" "$launcher"
chmod 644 -- "$tmp_entry"
mv -Tf -- "$tmp_entry" "$entry"
if command -v update-desktop-database >/dev/null; then update-desktop-database "$(dirname -- "$entry")"; fi
printf 'Installed inkwellr %s: %s\n' "$version" "$launcher"
