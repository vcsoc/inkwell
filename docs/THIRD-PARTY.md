# Third-party components

The custom inkwell license applies to original inkwell code and documentation, not to third-party software. Dependencies retain their original licenses and permissions, including any rights to modify them. Earlier valid license grants are not revoked.

The desktop uses Electron/Chromium and Python. Backend dependencies include FastAPI, Uvicorn, cryptography, HTTPX, nh3, python-dateutil, and their dependencies. PyInstaller supplies the packaged backend's bootloader; its distribution exception applies. Development tools such as Playwright, pytest, Ruff, Prettier, and the Electron packager have their own licenses. Exact resolved versions are recorded in `uv.lock` and `package-lock.json`.

Linux builds collect installed Python runtime dependency metadata, supplied license/notice files and SBOMs, the Python license, and PyInstaller notices into `resources/app/third-party-notices`. Electron's distribution includes its own license and Chromium third-party notices. `desktop/collect-notices.py` performs the Python collection without using user data or credentials.

This collection is not a legal/compliance audit. Redistributors must review the applicable licenses and any source/notice obligations for transitive and bundled native/OS libraries as well. Do not replace third-party licenses with the inkwell license. The custom inkwell terms should be reviewed by a qualified lawyer before relying on them for distribution.
