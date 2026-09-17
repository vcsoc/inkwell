import { packager } from '@electron/packager';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux' || process.arch !== 'x64')
  throw Error('This build target requires Linux x86_64.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
const dist = path.join(root, 'dist');
const source = path.join(build, 'electron-source');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0)
    throw result.error || Error(`${command} failed (${result.status})`);
}
await fs.mkdir(build, { recursive: true });
await fs.mkdir(dist, { recursive: true });
const oauth = JSON.parse(await fs.readFile(path.join(root, 'inkwell/oauth.json'), 'utf8'));
oauth.microsoft_client_id = (
  process.env.INKWELL_MICROSOFT_CLIENT_ID ?? oauth.microsoft_client_id
).trim();
if (
  oauth.microsoft_client_id &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oauth.microsoft_client_id)
)
  throw Error('INKWELL_MICROSOFT_CLIENT_ID must be a registered public application UUID.');
await fs.writeFile(path.join(build, 'oauth.json'), JSON.stringify(oauth));
if (!oauth.microsoft_client_id)
  console.warn(
    'Microsoft publisher registration is not configured; this build requires advanced manual registration.',
  );
run(process.env.INKWELL_UV || 'uv', [
  'run',
  '--frozen',
  '--group',
  'build',
  'pyinstaller',
  '--noconfirm',
  '--clean',
  '--noupx',
  '--onedir',
  '--name',
  'inkwell-server',
  '--distpath',
  'build/frozen',
  '--workpath',
  'build/pyinstaller',
  '--specpath',
  'build',
  '--paths',
  root,
  '--hidden-import',
  'inkwell.app',
  '--collect-submodules',
  'uvicorn',
  '--collect-data',
  'certifi',
  '--add-data',
  `${path.join(root, 'inkwell/static')}:inkwell/static`,
  '--add-data',
  `${path.join(build, 'oauth.json')}:inkwell`,
  'desktop/backend.py',
]);
await fs.rm(source, { recursive: true, force: true });
await fs.mkdir(path.join(source, 'desktop'), { recursive: true });
await fs.mkdir(path.join(source, 'inkwell', 'static'), { recursive: true });
await fs.writeFile(
  path.join(source, 'package.json'),
  JSON.stringify(
    {
      name: 'inkwell',
      productName: 'inkwell',
      version: metadata.version,
      description: metadata.description,
      main: 'desktop/main.cjs',
      license: 'SEE LICENSE IN LICENSE',
    },
    null,
    2,
  ),
);
await fs.copyFile(path.join(root, 'desktop/main.cjs'), path.join(source, 'desktop/main.cjs'));
await fs.copyFile(path.join(root, 'desktop/email-links.cjs'), path.join(source, 'desktop/email-links.cjs'));
await fs.copyFile(path.join(root, 'desktop/calendar-reminders.cjs'), path.join(source, 'desktop/calendar-reminders.cjs'));
await fs.copyFile(path.join(root, 'desktop/calendar-files.cjs'), path.join(source, 'desktop/calendar-files.cjs'));
await fs.copyFile(path.join(root, 'desktop/os-shortcut.cjs'), path.join(source, 'desktop/os-shortcut.cjs'));
for (const file of ['preload.cjs','file-export.cjs']) await fs.copyFile(path.join(root,'desktop',file),path.join(source,'desktop',file));
await fs.copyFile(
  path.join(root, 'inkwell/static/icon-512.png'),
  path.join(source, 'inkwell/static/icon-512.png'),
);
for (const filename of ['LICENSE', 'README.md', 'SECURITY.md', 'pyproject.toml', 'uv.lock']) {
  await fs.copyFile(path.join(root, filename), path.join(source, filename));
}
await fs.cp(path.join(root, 'docs'), path.join(source, 'docs'), { recursive: true });
run(process.env.INKWELL_UV || 'uv', ['run', '--frozen', '--group', 'build', 'python', 'desktop/collect-notices.py', path.join(source, 'third-party-notices')]);
const electronVersion = JSON.parse(
  await fs.readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8'),
).version;
const [appDir] = await packager({
  dir: source,
  name: 'inkwell',
  executableName: 'inkwell',
  appVersion: metadata.version,
  electronVersion,
  platform: 'linux',
  arch: 'x64',
  out: path.join(dist, 'desktop'),
  overwrite: true,
  asar: true,
  prune: false,
  extraResource: [
    path.join(build, 'frozen/inkwell-server'),
    path.join(root, 'inkwell/static/icon-512.png'),
    path.join(root, 'desktop/uninstall.sh'),
  ],
});
const name = `inkwell-${metadata.version}-linux-x64`;
const archive = path.join(dist, name + '.tar.gz');
run('tar', ['-czf', archive, '-C', appDir, '.']);
async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
const archiveHash = await hash(archive);
const stub = (await fs.readFile(path.join(root, 'desktop/installer.sh.in'), 'utf8'))
  .replaceAll('@VERSION@', metadata.version)
  .replaceAll('@SHA256@', archiveHash);
const installer = path.join(dist, name + '.run');
await fs.writeFile(installer, stub, { mode: 0o755 });
await pipeline(createReadStream(archive), createWriteStream(installer, { flags: 'a' }));
await fs.chmod(installer, 0o755);
await fs.writeFile(
  path.join(dist, 'SHA256SUMS'),
  `${archiveHash}  ${path.basename(archive)}\n${await hash(installer)}  ${path.basename(installer)}\n`,
);
console.log(
  `\nBuilt installer: ${installer}\nPackaged app: ${appDir}\nNo user data or credentials were included.\n`,
);
