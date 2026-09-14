# Linux installer

The Linux x86_64 build includes Electron, a frozen Python runtime, the Inkwell backend, static UI and required Python packages. The installed app does not need Node, npm, Python or uv. AI services/CLI runtimes remain optional external integrations you configure separately.

## Install

```sh
sh dist/inkwell-0.1.0-linux-x64.run
```

Run as your ordinary desktop user, **not root**. The installer works offline, verifies its embedded payload checksum, and installs:

- App releases: `~/.local/opt/inkwell/releases/`
- Active release symlink: `~/.local/opt/inkwell/current`
- Command: `~/.local/bin/inkwell`
- Launcher: `${XDG_DATA_HOME:-~/.local/share}/applications/inkwell.desktop`
- App icon in the same XDG data directory's icon tree
- Uninstaller: `~/.local/opt/inkwell/uninstall.sh`

Launch **Inkwell** from your app menu or run `~/.local/bin/inkwell`. It starts the bundled backend automatically and stops it when the app quits. No service, autostart entry, root package or global system configuration is installed.

The installer does **not** modify or delete the existing `~/.inkwell` workspace. On first app startup an additive database migration preserves existing password accounts while adding Microsoft OAuth metadata. Back up data with all Inkwell processes closed before upgrades.

Existing managed releases are retained for rollback; the active symlink is replaced atomically after extraction and backend validation. The installer refuses to overwrite an unrelated existing launcher or installation directory. Quit an already-running old Inkwell window before launching a newly installed version. Do not downgrade an active database to an older schema version.

## Uninstall

Quit Inkwell, then:

```sh
~/.local/opt/inkwell/uninstall.sh
```

This removes the application, launcher and icon, but **keeps mail/settings/credentials in `~/.inkwell`** and the Electron profile. `--yes` skips the uninstaller confirmation. Remove private workspace data separately only if you deliberately intend to erase it.

## Build from source

```sh
uv sync --frozen --group build
npm ci
node node_modules/electron/install.js  # only if npm blocked Electron's install script
npm run build:linux
```

Outputs under `dist/` include the self-extracting `.run` installer, a portable `.tar.gz`, a checksums file, and the unpacked Electron application under `dist/desktop/`. Build files are excluded from version control.

For installed-app smoke testing (temporary workspace, 15-second maximum per test):

```sh
INKWELL_TEST_EXECUTABLE="$HOME/.local/opt/inkwell/current/inkwell" npm run test:desktop
```

## Distribution boundaries

This is an **unsigned local Linux x86_64 test installer**, not a signed release or package-manager repository. It was built on the current Arch Linux host; Python/native libraries require a compatible Linux/glibc system. It is not guaranteed to run on older Linux distributions. Electron also requires normal desktop runtime libraries and working sandbox support. Do not disable the sandbox to work around missing system support.

SHA-256 detects accidental corruption, not the authenticity of a maliciously replaced installer. Signed installers, auto-updates, reproducible clean-room builds, broader Linux compatibility and macOS/Windows installers remain future distribution work.
