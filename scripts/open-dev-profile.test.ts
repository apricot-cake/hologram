import { expect, test, vi } from 'vitest';
const { main } = require('./open-dev-profile.cts');

test('状態表示はプロセス情報を読むだけで Chrome を起動しない', async () => {
  const argv = process.argv;
  const start = vi.fn();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.argv = ['node', 'open-dev-profile.cts', '--print'];
  try {
    await main({ options: () => ({ profile: 'dedicated', executablePath: 'chrome', output: 'build' }), runningPid: () => 7, start });
    expect(start).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain('TCP 公開なし');
  } finally {
    process.argv = argv;
    log.mockRestore();
  }
});

test('状態取得に失敗すれば未起動として扱わず、起動しない', async () => {
  const argv = process.argv;
  const start = vi.fn();
  process.argv = ['node', 'open-dev-profile.cts', '--print'];
  try {
    await expect(
      main({
        options: () => ({ profile: 'dedicated' }),
        runningPid: () => {
          throw new Error('CIM denied');
        },
        start,
      }),
    ).rejects.toThrow('CIM denied');
    expect(start).not.toHaveBeenCalled();
  } finally {
    process.argv = argv;
  }
});
