# Inkwell 0.1.14

Linux x86_64 folder-color discoverability update over 0.1.13.

- The Mail folder right-click menu now contains a visible color swatch. Click the swatch to choose and save that folder's color directly. The existing **Folder color…** dialog remains available for picking a color or resetting to the theme color.
- Right-click the Mail icon in the narrow application rail to open the Inbox folder menu as an alternative entry point. Keyboard users can focus Inbox and press Shift+F10, then End to reach the swatch.
- Colors are local appearance preferences only. No mail, provider folder, account, or draft is changed.

Schema remains **19**; the installer does not remove or replace your `~/.inkwell` workspace. Save any unsaved work and quit/relaunch an open 0.1.13 window to use the new menu; installation does not force-close it. This unsigned Linux x86_64 build may not run on older glibc systems. `SHA256SUMS` verifies integrity, not publisher authenticity.
