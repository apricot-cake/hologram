import { execFileSync } from 'node:child_process';
import { app, type BrowserWindow } from 'electron';
import { POST_LINK_SCHEME, parsePostLink, type PostLink } from '../shared/post-link.ts';

let pending: PostLink | null = null;

export function takePostLink(): PostLink | null {
  const target = pending;
  pending = null;
  return target;
}

export function registerPostLinkProtocol(): void {
  const args = app.isPackaged ? [] : [app.getAppPath()];
  if (!app.setAsDefaultProtocolClient(POST_LINK_SCHEME, process.execPath, args)) throw new Error('投稿リンクの登録に失敗しました');
  if (process.platform === 'win32') {
    // リンクを開く確認画面で、共用の Electron 実行ファイル名ではなくアプリ名を表示する。
    execFileSync('reg.exe', ['add', `HKCU\\Software\\Classes\\${POST_LINK_SCHEME}\\Application`, '/v', 'ApplicationName', '/t', 'REG_SZ', '/d', 'Hologram', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  }
}

export function receivePostLink(argv: string[], win: BrowserWindow | null | undefined): boolean {
  const target = argv.map(parsePostLink).find((value) => value !== null);
  if (!target) return false;
  pending = target;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('post-link-available');
  }
  return true;
}
