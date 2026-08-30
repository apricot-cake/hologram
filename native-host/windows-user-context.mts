import { execFileSync } from 'node:child_process';

export function windowsUserContextMatches(actualIdentity: string, userDomain: string | undefined, username: string | undefined): boolean {
  if (!userDomain || !username) return false;
  return actualIdentity.trim().toLowerCase() === `${userDomain}\\${username}`.toLowerCase();
}

export function assertWindowsUserContext(operation: string): void {
  if (process.platform !== 'win32') return;
  const actualIdentity = execFileSync('whoami.exe', [], { encoding: 'utf8' });
  if (windowsUserContextMatches(actualIdentity, process.env.USERDOMAIN, process.env.USERNAME)) return;
  throw new Error(`${operation} はユーザー領域から隔離されたWindows実行環境では実行できません。` + 'Chromeが読むHKCUまたはHologramの設定フォルダへ書き込むため、コマンド全体をユーザー領域への書き込みが許可された実行としてやり直してください。');
}
