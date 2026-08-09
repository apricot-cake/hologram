// Import a library from a ZIP — the whole flow for both archive formats (the
// complete export #485 and the legacy metadata.json + images/ one #322).
//
// main runs the picker and reads the archive either way; the renderer only gets
// the result back, plus — for the legacy format only — the archive's path, so it
// can ask main to finish the import once it has the #34 duplicate answer. Neither
// the raw bytes nor the unpacked records ever cross over here.
//
// Two entry points call this: the settings panel's import button
// (settings/sections/Data.tsx) and the first-run empty state's CTA
// (empty/EmptyState.tsx). They used to hold a copy each — Data.tsx inline and
// EmptyState.tsx through an orchestrator `export let` — which is how the two
// drifted (one awaited the library reload before reporting, the other didn't).
// Same split as clipboard-intake.ts / drop-intake.ts: the component owns the
// button, this module owns the flow next to the IPC calls it makes.
import { importComplete, importLegacyZip } from './posts.ts';
import { open as confirmOpen } from './confirm.ts';
import { loadPosts } from './post-grid-builder.ts';
import { notify } from './ui.ts';
import { t } from '../_shared/i18n.ts';

async function reportDone(imported: number, skipped: number): Promise<void> {
  if (loadPosts) await loadPosts();
  if (skipped > 0) notify(t('importSkipped', [imported, skipped]));
  else notify(t('imported', [imported]));
}

async function runLegacy(zipPath: string): Promise<void> {
  // #34: when an imported post is already in the library, ask Copy/Replace/Skip
  // just once (asking per-item would mean hundreds of prompts, so it's batched).
  // If there's no duplicate, main imports it immediately and this never appears.
  const first = await importLegacyZip(zipPath);
  if (!first || first.error) {
    notify(t('importFailed'));
    return;
  }
  if (!first.needsChoice) {
    await reportDone(first.imported, first.skipped);
    return;
  }
  const finish = async (mode: string) => {
    const r = await importLegacyZip(zipPath, mode);
    await reportDone(r.imported, r.skipped);
  };
  confirmOpen({
    message: t('importDuplicate', [first.duplicates]),
    description: t('importDuplicateDesc'),
    okLabel: t('importDuplicateReplace'),
    altLabel: t('importDuplicateCopy'),
    cancelLabel: t('importDuplicateSkip'),
    onOk: () => void finish('replace'),
    onAlt: () => void finish('copy'),
    // Esc lands here too, and skipping is the answer that changes the least —
    // the library keeps what it has.
    onCancel: () => void finish('skip'),
  });
}

export async function runZipImport(): Promise<void> {
  try {
    const res = await importComplete();
    if (res && res.canceled) return;
    notify(t('importing'));
    if (res && res.legacy && res.path) {
      // Bound once: the callbacks in runLegacy outlive the narrowing on res.path.
      await runLegacy(res.path);
      return;
    }
    if (!res || !res.ok) {
      if (loadPosts) await loadPosts();
      notify(t('importFailed'));
      return;
    }
    // A complete import that answered ok always carries both counters; the
    // fallbacks are only what the flat result shape (ipc-payloads.ts) forces.
    await reportDone(res.imported ?? 0, res.skipped ?? 0);
  } catch {
    notify(t('importFailed'));
  }
}
