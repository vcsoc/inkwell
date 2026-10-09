// Pinned, checksum-verified CPU inference runtime. No model/user data enters the installer.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function prepareLocalLlm() {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw Error('The bundled local translation runtime requires Linux x86_64.');
  const tag = 'b11514';
  const digest = 'b2b617fb28e9d1444235c30bb09a3704789a1840e16ead58a5f7be6eeae8beef';
  const archive = path.join(root, 'build', `llama-${tag}.tar.gz`);
  const destination = path.join(root, 'build/local-llm');
  await fs.mkdir(path.dirname(archive), { recursive: true });
  let bytes;
  try {
    bytes = await fs.readFile(archive);
  } catch {
    const response = await fetch(
      `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-ubuntu-x64.tar.gz`,
    );
    if (!response.ok) throw Error('Could not download the pinned local translation runtime.');
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== digest)
    throw Error('Local translation runtime checksum mismatch.');
  await fs.writeFile(archive, bytes);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  const result = spawnSync('tar', ['-xzf', archive, '-C', destination, '--strip-components=1'], {
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0)
    throw Error('Could not extract the local translation runtime.');
  // Keep only completion and its shared libraries/license; no HTTP server is shipped.
  const library =
    /^(?:libggml(?:-base|-cpu(?:-[a-z0-9-]+)?)?|libllama(?:-common|-completion-impl)?)\.so(?:\.\d+)*$/;
  for (const entry of await fs.readdir(destination))
    if (!library.test(entry) && entry !== 'llama-completion' && entry !== 'LICENSE')
      await fs.rm(path.join(destination, entry), { recursive: true, force: true });
  return destination;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await prepareLocalLlm());
