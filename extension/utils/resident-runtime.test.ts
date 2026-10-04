// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ overlay: vi.fn(), bulk: vi.fn(), bulkCleanup: vi.fn() }));
vi.mock('./capture-log.ts', () => ({ extensionOrigin: () => '', logSaveEvent: vi.fn() }));
vi.mock('./extractor/index.ts', () => ({ RESIDENT_MATCHES: [], getContentSite: () => ({ platform: 'x' }) }));
vi.mock('./overlay.ts', () => ({ startOverlay: mocks.overlay }));
vi.mock('./uncaught-report.ts', () => ({ installUncaughtReporting: vi.fn() }));
vi.mock('./ui-root.ts', () => ({ refreshUiRootStyles: vi.fn() }));
vi.mock('./bulk-discovery.ts', () => ({ startBulkDiscovery: mocks.bulk }));
vi.mock('wxt/utils/define-content-script', () => ({ defineContentScript: (config: { main: () => void }) => config }));

const OWNER = Symbol.for('hologram.resident-runtime');
const scope = globalThis as typeof globalThis & { [OWNER]?: { dispose: () => void } };
let main: () => void;
let runtime: { id: string; onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> }; sendMessage: ReturnType<typeof vi.fn> };
beforeAll(async () => {
  main = (await import('../entrypoints/resident.content.ts')).default.main as () => void;
});
beforeEach(() => {
  vi.clearAllMocks();
  runtime = { id: 'extension-id', onMessage: { addListener: vi.fn(), removeListener: vi.fn() }, sendMessage: vi.fn().mockResolvedValue(undefined) };
  vi.stubGlobal('chrome', { runtime });
  mocks.bulk.mockReturnValue(mocks.bulkCleanup);
});
afterEach(() => {
  scope[OWNER]?.dispose();
});

describe('同一ワールドへの常駐再注入', () => {
  test('次の overlay を開始する前に旧 overlay と listener を撤去する', async () => {
    const oldCleanup = vi.fn();
    const newCleanup = vi.fn();
    mocks.overlay.mockResolvedValueOnce(oldCleanup).mockImplementationOnce(async () => {
      expect(oldCleanup).toHaveBeenCalledOnce();
      return newCleanup;
    });
    main();
    await Promise.resolve();
    main();
    await Promise.resolve();
    expect(runtime.onMessage.removeListener).toHaveBeenCalledOnce();
    expect(newCleanup).not.toHaveBeenCalled();
    scope[OWNER]?.dispose();
    expect(newCleanup).toHaveBeenCalledOnce();
  });

  test('旧 overlay の非同期開始が遅れて完了しても新世代の UI を撤去しない', async () => {
    let finishOld!: (cleanup: () => void) => void;
    const oldCleanup = vi.fn();
    const newCleanup = vi.fn();
    mocks.overlay
      .mockImplementationOnce(
        () =>
          new Promise<() => void>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce(newCleanup);
    main();
    main();
    await Promise.resolve();
    finishOld(oldCleanup);
    await Promise.resolve();
    expect(oldCleanup).toHaveBeenCalledOnce();
    expect(newCleanup).not.toHaveBeenCalled();
    expect(runtime.sendMessage).toHaveBeenCalledOnce();
    scope[OWNER]?.dispose();
    expect(newCleanup).toHaveBeenCalledOnce();
    expect(runtime.onMessage.removeListener).toHaveBeenCalledTimes(2);
  });
});
