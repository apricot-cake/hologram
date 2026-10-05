import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = path.join(root, 'app/vendor/avif');
const buildDirectory = path.join(root, '.sandbox/avif-native-build');
const platform = `${process.platform}-${process.arch}`;
if (!['win32-x64', 'linux-x64'].includes(platform)) throw new Error(`AVIF 検査器の未対応プラットフォーム: ${platform}`);
const executableName = process.platform === 'win32' ? 'avif-validator.exe' : 'avif-validator';
const executable = path.join(outputDirectory, executableName);
const manifestPath = path.join(outputDirectory, 'build.json');
const revisions = {
  libavifRevision: 'c5240fc79fe5c2407e10afd35f5505ef6333ea49',
  dav1dRevision: 'b546257f770768b2c88258c533da38b91a06f737',
};
async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(filename)));
    else if (entry.isFile()) files.push(path.relative(root, filename).replaceAll(path.sep, '/'));
  }
  return files.sort();
}
const sourceFiles = [...(await collectFiles(path.join(root, 'native-image'))), 'scripts/build-avif-validator.ps1', 'scripts/prepare-avif-validator.mjs'];
const licenseFiles = [
  ['_deps/libavif-src/LICENSE', 'libavif-LICENSE'],
  ['_deps/dav1d-src/COPYING', 'dav1d-COPYING'],
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (filename) => fs.readFile(filename);
async function sourceHash() {
  const digest = createHash('sha256');
  for (const filename of sourceFiles)
    digest
      .update(filename)
      .update('\0')
      .update(await read(path.join(root, filename)))
      .update('\0');
  return digest.digest('hex');
}

const environment = { ...process.env };
// 開発機に既に用意された隔離ツールを使う。prepare 自体はツールをインストールしない。
const tools = path.join(root, '.sandbox/avif-build-tools');
if (
  process.platform === 'win32' &&
  (await fs.access(tools).then(
    () => true,
    () => false,
  ))
) {
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  environment[pathKey] = [path.join(tools, 'bin'), path.join(tools, 'Scripts'), path.join(tools, 'nasm-3.01'), environment[pathKey] ?? ''].join(path.delimiter);
  environment.PYTHONPATH = [tools, environment.PYTHONPATH ?? ''].filter(Boolean).join(path.delimiter);
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, env: environment, windowsHide: true, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} に失敗しました (${result.status}): ${(result.stderr ?? '').slice(0, 1_024)}`);
  return (result.stdout ?? '').trim();
}

function verifyVersion() {
  if (!/^libavif 1\.4\.2; dav1d \[dec\]:1\.5\.3/.test(run(executable, ['--version'], true))) throw new Error('固定した decoder version と一致しません。');
}

async function verifySources() {
  for (const [name, revision] of Object.entries(revisions)) {
    const directory = name === 'libavifRevision' ? 'libavif-src' : 'dav1d-src';
    if (run('git', ['-C', path.join(buildDirectory, '_deps', directory), 'rev-parse', 'HEAD'], true) !== revision) throw new Error(`固定した ${directory} revision と一致しません。`);
  }
}

const currentSourceHash = await sourceHash();
let manifest;
try {
  manifest = JSON.parse((await read(manifestPath)).toString('utf8').replace(/^\uFEFF/, ''));
} catch {}
let cached = manifest?.sourceHash === currentSourceHash && manifest?.platform === platform && Object.entries(revisions).every(([name, value]) => manifest?.[name] === value);
if (cached) {
  try {
    cached = hash(await read(executable)) === manifest.sha256;
    const builtExecutable = path.join(buildDirectory, `hologram-avif-validator${process.platform === 'win32' ? '.exe' : ''}`);
    cached &&= hash(await read(builtExecutable)) === manifest.sha256;
    for (const [source, destination] of licenseFiles) cached &&= hash(await read(path.join(buildDirectory, source))) === hash(await read(path.join(outputDirectory, destination)));
    cached &&= hash(await read(path.join(root, 'LICENSE'))) === hash(await read(path.join(outputDirectory, 'hologram-LICENSE')));
    await verifySources();
    verifyVersion();
  } catch {
    cached = false;
  }
}
if (!cached) {
  if (process.platform === 'win32') {
    run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/build-avif-validator.ps1')]);
  } else {
    run('cmake', ['-S', path.join(root, 'native-image'), '-B', buildDirectory, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release']);
    run('cmake', ['--build', buildDirectory, '--config', 'Release']);
    run('ctest', ['--test-dir', buildDirectory, '--build-config', 'Release', '--output-on-failure']);
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.copyFile(path.join(buildDirectory, 'hologram-avif-validator'), executable);
    await fs.chmod(executable, 0o755);
    for (const [source, destination] of licenseFiles) await fs.copyFile(path.join(buildDirectory, source), path.join(outputDirectory, destination));
  }
  await verifySources();
  verifyVersion();
  if ((await sourceHash()) !== currentSourceHash) throw new Error('ビルド中に検査器のソースが変更されました。prepare を再実行してください。');
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(outputDirectory, 'hologram-LICENSE'));
  const sha256 = hash(await read(executable));
  manifest = { platform, libavif: '1.4.2', dav1d: '1.5.3', ...revisions, sourceHash: currentSourceHash, sha256 };
  await fs.writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.rename(`${manifestPath}.tmp`, manifestPath);
}
console.log(`AVIF 検査器: ${cached ? '検証済みのビルドを使用' : '固定ソースからビルド'} (${platform}, SHA256 ${manifest.sha256})`);
