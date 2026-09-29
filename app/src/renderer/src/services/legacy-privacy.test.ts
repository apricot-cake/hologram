// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getPrefs } = vi.hoisted(() => ({ getPrefs: vi.fn() }));

vi.mock('./ipc.ts', () => ({ hologramIpc: { getPrefs } }));

import { restoreLegacyPrivacyMode } from './legacy-privacy.ts';

describe('restoreLegacyPrivacyMode', () => {
  beforeEach(() => {
    getPrefs.mockReset();
    document.documentElement.removeAttribute('data-legacy-privacy-mode');
  });

  test('protects media when an older config left privacy mode enabled', async () => {
    getPrefs.mockResolvedValue({ privacyMode: true });

    await restoreLegacyPrivacyMode();

    expect(document.documentElement.hasAttribute('data-legacy-privacy-mode')).toBe(true);
  });

  test('does not change the display for users without the saved preference', async () => {
    getPrefs.mockResolvedValue({ privacyMode: false });

    await restoreLegacyPrivacyMode();

    expect(document.documentElement.hasAttribute('data-legacy-privacy-mode')).toBe(false);
  });
});
