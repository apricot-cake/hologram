'use strict';

// Cloud-sync detection for the save-folder picker (#95). The library is written
// live (sidecars rewritten in place, images added/removed), so a sync client
// racing those writes can corrupt or resurrect files — the mirror destination is
// the one place cloud storage is supported by design. Nothing here BLOCKS: the
// detection is a name/env heuristic and false positives are expected, so the
// caller only warns. Pulled out as a pure function (like backup-guard.ts) so it
// unit-tests without spinning up Electron.

import path from 'node:path';

// Path SEGMENT patterns → provider label. Matched against whole segments, never as
// substrings, so `~/Projects/dropbox-clone` or a post tagged "box" can't trip it.
// Deliberately conservative: bare `Box`/`Sync`/`Mega` are common folder names a
// user picks themselves, so only their qualified forms are listed.
const SEGMENT_RULES: { re: RegExp; provider: string }[] = [
  // Personal is plain `OneDrive`; work/school is `OneDrive - <Tenant>`.
  { re: /^onedrive(\s*-\s*.+)?$/, provider: 'OneDrive' },
  { re: /^dropbox(\s*\(.+\))?$/, provider: 'Dropbox' }, // `Dropbox (Personal)` / `Dropbox (Team)`
  { re: /^(google\s*drive|my\s*drive|drivefs|googledrive)$/, provider: 'Google Drive' },
  { re: /^(icloud\s*drive|iclouddrive|com~apple~clouddocs)$/, provider: 'iCloud Drive' },
  { re: /^nextcloud$/, provider: 'Nextcloud' },
  { re: /^owncloud$/, provider: 'ownCloud' },
  { re: /^creative\s*cloud\s*files$/, provider: 'Creative Cloud' },
  { re: /^megasync$/, provider: 'MEGA' },
  { re: /^pclouddrive$/, provider: 'pCloud' },
  { re: /^(yandex\.?disk)$/, provider: 'Yandex.Disk' },
  { re: /^(proton\s*drive|protondrive)$/, provider: 'Proton Drive' },
  { re: /^box\s*sync$/, provider: 'Box' },
];

// Env vars whose value is a sync ROOT path → provider label. These are the reliable
// signal on Windows (a renamed OneDrive folder still exports %OneDrive%).
const ENV_RULES: { keys: string[]; provider: string }[] = [{ keys: ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'], provider: 'OneDrive' }];

function normalizeSegment(seg: string) {
  return seg.trim().toLowerCase();
}

// True when child is at or below parent (same rule as main's pathIsInside).
function isInside(child: string, parent: string) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

// The cloud provider `dir` appears to live under, or null when nothing matches.
// `env` is injected so tests can drive it without touching process.env.
function cloudSyncProviderOf(dir: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!dir || typeof dir !== 'string' || !dir.trim()) return null;

  // Env roots first — an exact path beats a name guess.
  for (const rule of ENV_RULES) {
    for (const key of rule.keys) {
      const root = env[key];
      if (root && String(root).trim() && isInside(dir, String(root))) return rule.provider;
    }
  }

  // Then any segment of the path that names a known sync root.
  for (const raw of path.resolve(dir).split(/[\\/]+/)) {
    const seg = normalizeSegment(raw);
    if (!seg) continue;
    for (const rule of SEGMENT_RULES) {
      if (rule.re.test(seg)) return rule.provider;
    }
  }
  return null;
}

export { cloudSyncProviderOf, SEGMENT_RULES, ENV_RULES };
