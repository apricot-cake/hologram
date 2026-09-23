const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function verificationRoot(): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const root = path.resolve(process.env.HOLOGRAM_VERIFICATION_DIR || path.join(localAppData, 'Hologram', 'verification'));
  if (isWithin(repoRoot, root)) throw new Error(`検証成果物の保存先をリポジトリ内には置けません: ${root}`);
  return root;
}

function resolveVerificationOutput(output: string | undefined, name: string): string {
  if (!output) return path.join(verificationRoot(), name);
  const resolved = path.resolve(output);
  if (isWithin(repoRoot, resolved)) throw new Error(`検証成果物の保存先をリポジトリ内には置けません: ${resolved}`);
  return resolved;
}

module.exports = { repoRoot, isWithin, verificationRoot, resolveVerificationOutput };
