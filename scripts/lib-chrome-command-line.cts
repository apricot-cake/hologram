'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

// 引用符の処理は CommandLineToArgvW に任せ、ここでは Chrome の switch だけを読む。
function chromeSwitches(argv: readonly string[]): Map<string, string> {
  const switches = new Map<string, string>();
  for (const raw of argv.slice(1)) {
    const arg = raw.trim();
    if (arg === '--') break;
    const prefix = arg.startsWith('--') ? 2 : arg.startsWith('-') || arg.startsWith('/') ? 1 : 0;
    if (!prefix || arg.length === prefix) continue;
    const separator = arg.indexOf('=');
    const name = arg.slice(prefix, separator < 0 ? undefined : separator);
    // Windows のシェルからの起動では、この後が一つの通常引数になる。
    if (name === 'single-argument') break;
    switches.set(name.toLowerCase(), separator < 0 ? '' : arg.slice(separator + 1));
  }
  return switches;
}

function profilePid(processes: readonly { ProcessId: number; Args: string[] }[], profile: string): number | null {
  const wanted = path.resolve(profile).toLowerCase();
  for (const proc of processes) {
    const switches = chromeSwitches(proc.Args);
    if (switches.has('type')) continue;
    const dir = switches.get('user-data-dir');
    if (dir && path.resolve(dir).toLowerCase() === wanted) return proc.ProcessId;
  }
  return null;
}

function runningChromePid(profile: string): number | null {
  const json = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'read-chrome-processes.ps1')], { encoding: 'utf8', windowsHide: true });
  return profilePid(JSON.parse(json.replace(/^\uFEFF/, '')), profile);
}

module.exports = { chromeSwitches, profilePid, runningChromePid };
