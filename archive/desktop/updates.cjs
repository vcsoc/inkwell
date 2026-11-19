'use strict';
// Only the trusted main process can fetch and install the publisher's fixed Linux release assets.
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { createWriteStream } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REPOSITORY = 'https://api.github.com/repos/vcsoc/inkwell/releases/latest';
const LIMIT = 350_000_000;
const timeout = (url) => AbortSignal.timeout(url.endsWith('.run') ? 15 * 60 * 1000 : 20000);
const versionParts = (value) =>
  /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
function newer(remote, local) {
  const a = versionParts(remote),
    b = versionParts(local);
  return (
    !!a &&
    !!b &&
    a.some(
      (part, index) =>
        part !== b[index] &&
        a.slice(0, index).every((item, at) => item === b[at]) &&
        part > b[index],
    )
  );
}
function trustedAsset(asset, filename, version) {
  if (
    asset?.name !== filename ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > LIMIT
  )
    throw Error('Release asset has an invalid name or size.');
  const url = new URL(asset.browser_download_url);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.pathname !== `/vcsoc/inkwell/releases/download/v${version}/${filename}` ||
    url.search ||
    url.hash
  )
    throw Error('Release asset is not on the official Inkwell repository.');
  return url.toString();
}
async function network(url, headers = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'inkwell-updater', Accept: 'application/octet-stream', ...headers },
    signal: timeout(url),
  });
  if (!response.ok || !response.url.startsWith('https://'))
    throw Error(`Update download failed (HTTP ${response.status}).`);
  return response;
}
async function readSmall(response, maximum) {
  const size = Number(response.headers.get('content-length') || 0);
  if (size > maximum) throw Error('Release metadata is too large.');
  let text = '';
  for await (const chunk of response.body) {
    text += Buffer.from(chunk).toString('utf8');
    if (Buffer.byteLength(text) > maximum) throw Error('Release metadata is too large.');
  }
  return text;
}
async function loadState(file) {
  try {
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    return /^\d+\.\d+\.\d+$/.test(state.skipped) ? state.skipped : '';
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return '';
    throw error;
  }
}
async function storeState(file, skipped) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + process.pid + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify({ skipped }), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
function installed(home, executable, packaged) {
  if (!packaged || process.platform !== 'linux' || process.arch !== 'x64') return false;
  const root = path.join(home, '.local/opt/inkwell');
  if (!fsSync.existsSync(path.join(root, '.inkwell-managed'))) return false;
  const releases = path.join(root, 'releases');
  let actual;
  try {
    actual = fsSync.realpathSync(executable);
  } catch {
    return false;
  }
  const relative = path.relative(releases, actual);
  return !!relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function createUpdater({
  version,
  home,
  executable,
  packaged,
  userData,
  emit,
  beforeRestart,
  restart,
  request = network,
  runInstaller = null,
}) {
  const supported = installed(home, executable, packaged);
  const stateFile = path.join(userData, 'update-settings.json');
  let candidate = null;
  let busy = false;
  const signal = (phase, percent, detail) => emit({ phase, percent, detail });
  async function check(force = false) {
    if (!supported) return { status: 'unsupported' };
    if (busy) return { status: 'busy' };
    const response = await request(REPOSITORY, { Accept: 'application/vnd.github+json' });
    const release = JSON.parse(await readSmall(response, 128_000));
    const match = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name || '');
    if (!match || release.draft || release.prerelease || !Array.isArray(release.assets))
      throw Error('GitHub did not return a stable Inkwell release.');
    const next = match[1];
    if (!newer(next, version)) {
      candidate = null;
      return { status: 'current', version };
    }
    const filename = `inkwell-${next}-linux-x64.run`;
    const installer = release.assets.find((asset) => asset.name === filename);
    const sums = release.assets.find((asset) => asset.name === 'SHA256SUMS');
    const installerUrl = trustedAsset(installer, filename, next);
    const sumsUrl = trustedAsset(sums, 'SHA256SUMS', next);
    candidate = { version: next, filename, installerUrl, sumsUrl, size: installer.size };
    if (!force && (await loadState(stateFile)) === next)
      return { status: 'skipped', version: next };
    return { status: 'available', version: next, size: installer.size };
  }
  async function skip(version) {
    if (!candidate || busy || candidate.version !== version)
      throw Error('This release is no longer the latest. Check for updates again.');
    await storeState(stateFile, candidate.version);
    return { status: 'skipped', version: candidate.version };
  }
  async function install(version) {
    if (!candidate || candidate.version !== version || busy || !supported)
      throw Error('This release is no longer available. Check for updates again.');
    busy = true;
    const target = candidate;
    let directory;
    try {
      signal('download', 0, 'Preparing secure download…');
      const manifest = await readSmall(await request(target.sumsUrl), 12_000);
      const line = manifest.split(/\r?\n/).find((entry) => entry.endsWith('  ' + target.filename));
      const expected = line?.slice(0, 64).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(expected) || line !== `${expected}  ${target.filename}`)
        throw Error('Release checksum manifest is missing or invalid.');
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'inkwell-update-'));
      const file = path.join(directory, target.filename);
      const response = await request(target.installerUrl);
      const size = Number(response.headers.get('content-length') || target.size);
      if (size !== target.size)
        throw Error('Installer download size differs from its release metadata.');
      const digest = createHash('sha256');
      let received = 0;
      let lastPercent = -1;
      let lastReport = 0;
      async function* chunks() {
        for await (const chunk of Readable.fromWeb(response.body)) {
          received += chunk.length;
          if (received > target.size) throw Error('Installer exceeds its published size.');
          digest.update(chunk);
          const percent = Math.floor((received / target.size) * 100);
          if (percent !== lastPercent && (Date.now() - lastReport > 120 || percent === 100)) {
            lastPercent = percent;
            lastReport = Date.now();
            signal(
              'download',
              percent,
              `${(received / 1048576).toFixed(1)} / ${(target.size / 1048576).toFixed(1)} MB`,
            );
          }
          yield chunk;
        }
      }
      await pipeline(
        Readable.from(chunks()),
        createWriteStream(file, { flags: 'wx', mode: 0o600 }),
      );
      if (received !== target.size || digest.digest('hex') !== expected)
        throw Error(
          'Installer checksum does not match the official release. Nothing was installed.',
        );
      signal('install', 0, 'Installer verified; preparing…');
      const run =
        runInstaller ||
        ((filename, progress) =>
          new Promise((resolve, reject) => {
            const child = spawn('sh', [filename], {
              env: { ...process.env, INKWELL_UPDATE_PROGRESS: '1' },
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            let output = '';
            let pending = '';
            for (const stream of [child.stdout, child.stderr])
              stream.on('data', (chunk) => {
                output = (output + chunk.toString()).slice(-3000);
                pending = (pending + chunk.toString()).slice(-3000);
                const lines = pending.split(/\r?\n/);
                pending = lines.pop();
                for (const line of lines) {
                  const match = /^INKWELL_UPDATE_STEP=(\d+):(.+)$/.exec(line);
                  if (match) progress(Number(match[1]), match[2]);
                }
              });
            child.on('error', reject);
            child.on('close', (code) =>
              code === 0
                ? resolve()
                : reject(
                    Error(
                      `Installer failed (${code}): ${output.replace(/INKWELL_UPDATE_STEP=\d+:/g, '')}`,
                    ),
                  ),
            );
          }));
      await run(file, (percent, detail) => signal('install', percent, detail));
      signal('install', 100, 'Installed. Restarting Inkwell…');
      let safe = false;
      try {
        safe = await beforeRestart();
      } catch {
        /* Preserve the editor if flushing failed. */
      }
      if (!safe) return { status: 'restart-needed' };
      await fs.rm(directory, { recursive: true, force: true });
      directory = null;
      restart(path.join(home, '.local/opt/inkwell/current/inkwell'));
      return { status: 'restarting' };
    } catch (error) {
      signal('error', 0, error.message);
      throw error;
    } finally {
      busy = false;
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    }
  }
  return { supported, check, skip, install };
}
module.exports = { createUpdater, newer, trustedAsset, installed };
