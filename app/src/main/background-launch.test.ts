import { expect, test } from 'vitest';
import { BACKGROUND_LAUNCH_FLAG, backgroundRelaunchArgs, hideBackgroundWindows, isBackgroundLaunch } from './background-launch.ts';

test('配備による再起動は背景起動の指定を維持する', () => {
  const argv = ['app', '--remote-debugging-port=9222'];
  const args = backgroundRelaunchArgs(argv);
  expect(args).toEqual([...argv, BACKGROUND_LAUNCH_FLAG]);
  expect(backgroundRelaunchArgs(args)).toEqual(args);
  expect(isBackgroundLaunch(args, {})).toBe(true);
});

test('検証側の起動環境を単一インスタンス通知へ渡す', () => {
  expect(isBackgroundLaunch(['app'], {})).toBe(false);
  for (const key of ['HOLOGRAM_START_MINIMIZED', 'HOLOGRAM_START_INACTIVE', 'HOLOGRAM_E2E_HIDDEN']) expect(isBackgroundLaunch(['app'], { [key]: '1' })).toBe(true);
});

test('背景起動では追加ウィンドウも非表示にする', () => {
  expect(hideBackgroundWindows([BACKGROUND_LAUNCH_FLAG], {})).toBe(true);
  for (const key of ['HOLOGRAM_START_MINIMIZED', 'HOLOGRAM_START_INACTIVE', 'HOLOGRAM_E2E_HIDDEN']) expect(hideBackgroundWindows([], { [key]: '1' })).toBe(true);
  expect(hideBackgroundWindows([], {})).toBe(false);
});
