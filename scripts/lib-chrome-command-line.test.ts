import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const { chromeSwitches, profilePid } = require('./lib-chrome-command-line.cts');

describe('開発用 Chrome のプロセス識別', () => {
  test.each(['--user-data-dir=', '-user-data-dir=', '/user-data-dir=', '--USER-DATA-DIR='])('Windows の %s を完全な引数として読む', (prefix) => {
    expect(profilePid([{ ProcessId: 7, Args: ['chrome.exe', `${prefix}C:\\Users\\Jane Doe\\日本語`] }], 'C:\\Users\\Jane Doe\\日本語')).toBe(7);
  });

  test('URL・別の switch の値・別名をプロファイルとして扱わない', () => {
    for (const arg of ['https://example.test/?q=--user-data-dir=C:\\dev', '--example=--user-data-dir=C:\\dev', '--user-data-directory=C:\\dev']) {
      expect(profilePid([{ ProcessId: 7, Args: ['chrome.exe', arg] }], 'C:\\dev')).toBeNull();
    }
  });

  test('重複 switch は最後の値を採用する', () => {
    const processes = [{ ProcessId: 7, Args: ['chrome.exe', '--user-data-dir=C:\\first', '--user-data-dir=C:\\last'] }];
    expect(profilePid(processes, 'C:\\first')).toBeNull();
    expect(profilePid(processes, 'C:\\last')).toBe(7);
  });

  test.each(['--', '--single-argument'])('%s 以降を switch として扱わない', (terminator) => {
    expect(chromeSwitches(['chrome.exe', '--user-data-dir=C:\\before', terminator, '--user-data-dir=C:\\after']).get('user-data-dir')).toBe('C:\\before');
    expect(profilePid([{ ProcessId: 7, Args: ['chrome.exe', terminator, '--user-data-dir=C:\\after'] }], 'C:\\after')).toBeNull();
  });

  test('実際の type switch だけで子プロセスを除外する', () => {
    const base = ['chrome.exe', '--user-data-dir=C:\\dev'];
    expect(profilePid([{ ProcessId: 7, Args: [...base, 'https://example.test/?q=--type=renderer'] }], 'C:\\dev')).toBe(7);
    expect(
      profilePid(
        [
          { ProcessId: 8, Args: [...base, '--type=renderer'] },
          { ProcessId: 7, Args: base },
        ],
        'C:\\dev',
      ),
    ).toBe(7);
    expect(profilePid([{ ProcessId: 8, Args: [...base, '--type'] }], 'C:\\dev')).toBeNull();
  });

  test('空のプロファイル値と空の一覧は一致しない', () => {
    expect(profilePid([{ ProcessId: 7, Args: ['chrome.exe', '--user-data-dir='] }], process.cwd())).toBeNull();
    expect(profilePid([], process.cwd())).toBeNull();
  });

  test.skipIf(process.platform !== 'win32')('Windows API が引用方法・日本語・末尾バックスラッシュを復元する', () => {
    const directory = 'C:\\Users\\Jane Doe\\日本語\\';
    const lines = ['chrome.exe "--user-data-dir=C:\\Users\\Jane Doe\\日本語\\\\"', 'chrome.exe --user-data-dir="C:\\Users\\Jane Doe\\日本語\\\\"', 'chrome.exe "https://example.test/?q=--user-data-dir=C:\\dev"'];
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference = 'Stop'; [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false); . $env:HOLOGRAM_ARGV_HELPER; $lines = [Console]::In.ReadToEnd() | ConvertFrom-Json; $result = @($lines | ForEach-Object { [PSCustomObject]@{ Args = @([HologramChromeArguments]::Parse($_)) } }); ConvertTo-Json -InputObject $result -Depth 4 -Compress",
      ],
      {
        encoding: 'utf8',
        input: JSON.stringify(lines),
        windowsHide: true,
        env: { ...process.env, HOLOGRAM_ARGV_HELPER: path.join(__dirname, 'read-chrome-processes.ps1') },
      },
    );
    const parsed = JSON.parse(output.replace(/^\uFEFF/, ''));
    expect(parsed[0].Args).toEqual(['chrome.exe', `--user-data-dir=${directory}`]);
    expect(parsed[1].Args).toEqual(parsed[0].Args);
    expect(profilePid([{ ProcessId: 7, Args: parsed[0].Args }], directory)).toBe(7);
    expect(profilePid([{ ProcessId: 7, Args: parsed[2].Args }], 'C:\\dev')).toBeNull();
  });
});
