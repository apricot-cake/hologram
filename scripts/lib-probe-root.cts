'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function validateProbeLabel(label: string): void {
  if (!label || label === '.' || label === '..') throw new Error('--label は空でない安全なディレクトリ名でなければならない');
  if (path.isAbsolute(label) || /[\\/]/.test(label)) throw new Error('--label に絶対パスやパス区切りは使えない');
  if (/[ .]$/.test(label)) throw new Error('--label の末尾に空白またはピリオドは使えない');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) throw new Error('--label は英数字で始まる英数字・ピリオド・ハイフン・アンダースコアだけを使える');
  if (WINDOWS_RESERVED_NAME.test(label)) throw new Error('--label に Windows の予約名は使えない');
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function rejectLinksBetween(parent: string, child: string): void {
  const relative = path.relative(parent, child);
  let current = parent;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`プローブ先に symlink/junction は使えない: ${current}`);
  }
}

/** 削除や書き込みの直前に呼び、最終的な絶対パスを改めて検査する。 */
function assertSafeProbeRoot(repoRoot: string, probeRoot: string): void {
  const absoluteRepo = path.resolve(repoRoot);
  const probeBase = path.resolve(absoluteRepo, '.probe66');
  const absoluteTarget = path.resolve(probeRoot);

  if (!isInside(probeBase, absoluteTarget) || path.dirname(absoluteTarget) !== probeBase) {
    throw new Error(`プローブ先は .probe66 直下でなければならない: ${absoluteTarget}`);
  }

  rejectLinksBetween(absoluteRepo, absoluteTarget);

  if (fs.existsSync(probeBase) && fs.existsSync(absoluteTarget)) {
    const realBase = fs.realpathSync.native(probeBase);
    const realTarget = fs.realpathSync.native(absoluteTarget);
    if (!isInside(realBase, realTarget) || realTarget === realBase) throw new Error(`プローブ先が .probe66 の外を指している: ${absoluteTarget}`);
  }
}

function resolveProbeRoot(repoRoot: string, label: string): string {
  validateProbeLabel(label);
  const probeRoot = path.resolve(repoRoot, '.probe66', label);
  assertSafeProbeRoot(repoRoot, probeRoot);
  return probeRoot;
}

module.exports = { assertSafeProbeRoot, resolveProbeRoot, validateProbeLabel };
