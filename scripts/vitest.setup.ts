import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Sandbox convention (CLAUDE.md): never let a test see the real config dir.
// One temp dir PER TEST FILE — setup files run once per file, before that file's
// imports, so a suite that reads HOLOGRAM_CONFIG_DIR at module load still sees
// it. Per-file (the old aggregator shared one dir across all suites) because
// Vitest runs files in parallel and two suites writing the same config dir would
// race.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tests-'));
process.env.HOLOGRAM_CONFIG_DIR = sandbox;

afterAll(() => {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});
