import { expect, test, vi } from 'vitest';
const { main } = require('./open-dev-profile.cts');
const { developmentChromeStatus } = require('./lib-chrome-command-line.cts');
const options = { profile: 'C:\\dedicated', executablePath: 'chrome', output: 'build' };

test.each([
  { args: ['--remote-debugging-port=9223', '--remote-debugging-address=127.0.0.1'], expected: '警告: TCP 公開用', forbidden: 'TCP 公開なし', transport: 'tcp' },
  { args: ['--remote-debugging-port=0', '--remote-debugging-pipe'], expected: '警告: TCP 公開用', forbidden: 'TCP 公開なし', transport: 'tcp' },
  { args: ['--remote-debugging-address=0.0.0.0'], expected: '警告: TCP 公開用', forbidden: 'TCP 公開なし', transport: 'tcp' },
  { args: ['--remote-debugging-pipe'], expected: 'pipe 起動（TCP 公開指定なし', forbidden: '警告: TCP 公開用', transport: 'pipe' },
  { args: [], expected: '外部起動・未管理', forbidden: '管理された pipe', transport: 'unmanaged' },
])('状態表示は実際の専用 Chrome の引数から $transport を判定する: $args', async ({ args, expected, forbidden, transport }) => {
  const argv = process.argv;
  const start = vi.fn();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.argv = ['node', 'open-dev-profile.cts', '--print'];
  const read = () => [
    { ProcessId: 1, Args: ['chrome.exe', '--user-data-dir=C:\\daily', '--remote-debugging-port=9000'] },
    { ProcessId: 2, Args: ['chrome.exe', '--user-data-dir=C:\\dedicated', '--type=renderer', '--remote-debugging-port=9001'] },
    { ProcessId: 7, Args: ['chrome.exe', '--user-data-dir=C:\\dedicated', '--profile-directory=Default', ...args] },
  ];
  try {
    await main({ options: () => options, status: (profile) => developmentChromeStatus(profile, read), start });
    expect(start).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain(expected);
    expect(log.mock.calls[0][0]).not.toContain(forbidden);
    expect(log.mock.calls[0][0]).toContain('pid 7');
    expect(developmentChromeStatus(options.profile, read).transport).toBe(transport);
  } finally {
    process.argv = argv;
    log.mockRestore();
  }
});

test('停止中は次回起動の設定として表示し、起動済みの安全性を表さない', async () => {
  const argv = process.argv;
  const start = vi.fn();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.argv = ['node', 'open-dev-profile.cts', '--print'];
  try {
    await main({ options: () => options, status: (profile) => developmentChromeStatus(profile, () => []), start });
    expect(start).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain('起動中: いいえ');
    expect(log.mock.calls[0][0]).toContain('停止中（次回起動の設定:');
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
        options: () => options,
        status: (profile) =>
          developmentChromeStatus(profile, () => {
            throw new Error('CIM denied');
          }),
        start,
      }),
    ).rejects.toThrow('CIM denied');
    expect(start).not.toHaveBeenCalled();
  } finally {
    process.argv = argv;
  }
});
