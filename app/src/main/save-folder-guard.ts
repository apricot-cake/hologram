'use strict';

// 保存フォルダピッカー向けのクラウド同期検出（#95）。ライブラリは実時間で
// 書かれる（sidecar はその場で書き換えられ、画像は追加・削除される）ので、
// その書き込みと競合する同期クライアントはファイルを壊したり復活させたり
// しうる——クラウドストレージが設計上サポートされる場所は、ミラーの置き場
// ただ1つ。ここには一切のブロックが無い: この検出は名前／環境変数に頼る
// ヒューリスティックで、誤検出は織り込み済みなので、呼び出し元はただ警告する
// だけ。（backup-guard.ts と同様に）純粋関数として切り出してあり、Electron を
// 起動せずに単体テストできる。

import path from 'node:path';

// パスの「セグメント」パターン → プロバイダのラベル。部分文字列としてではなく、
// セグメント全体に対して照合するので、`~/Projects/dropbox-clone` や「box」と
// タグ付けられた投稿でこれが誤発火することはない。意図して控えめにしてある:
// 素の `Box`／`Sync`／`Mega` は利用者自身が選ぶありふれたフォルダ名なので、
// それらを限定した形だけを一覧に載せる。
const SEGMENT_RULES: { re: RegExp; provider: string }[] = [
  // 個人用は素の `OneDrive`。仕事／学校用は `OneDrive - <Tenant>`。
  { re: /^onedrive(\s*-\s*.+)?$/, provider: 'OneDrive' },
  { re: /^dropbox(\s*\(.+\))?$/, provider: 'Dropbox' }, // `Dropbox (Personal)` / `Dropbox (Team)`
  { re: /^(google\s*drive|my\s*drive|drivefs|googledrive)$/, provider: 'Google Drive' },
  { re: /^(icloud\s*drive|iclouddrive|com~apple~clouddocs)$/, provider: 'iCloud Drive' },
  { re: /^nextcloud$/, provider: 'Nextcloud' },
  { re: /^owncloud$/, provider: 'ownCloud' },
  { re: /^creative\s*cloud\s*files$/, provider: 'Creative Cloud' },
  { re: /^megasync$/, provider: 'MEGA' },
  { re: /^pclouddrive$/, provider: 'pCloud' },
  { re: /^(yandex\.?disk)$/, provider: 'Yandex.Disk' },
  { re: /^(proton\s*drive|protondrive)$/, provider: 'Proton Drive' },
  { re: /^box\s*sync$/, provider: 'Box' },
];

// 値が同期の「root」パスになっている環境変数 → プロバイダのラベル。これは
// Windows での信頼できる合図（OneDrive フォルダを改名しても %OneDrive% は
// そのままエクスポートされ続ける）。
const ENV_RULES: { keys: string[]; provider: string }[] = [{ keys: ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'], provider: 'OneDrive' }];

function normalizeSegment(seg: string) {
  return seg.trim().toLowerCase();
}

// child が parent と同じか、その下にある時に true（main の pathIsInside と同じ規則）。
function isInside(child: string, parent: string) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

// `dir` がその配下にあるように見えるクラウドプロバイダ。何も一致しなければ
// null。`env` は注入する形にしてあり、テストが process.env に触れずに動かせる。
function cloudSyncProviderOf(dir: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!dir || typeof dir !== 'string' || !dir.trim()) return null;

  // まず環境変数の root から——正確なパスは名前による推測に勝る。
  for (const rule of ENV_RULES) {
    for (const key of rule.keys) {
      const root = env[key];
      if (root && String(root).trim() && isInside(dir, String(root))) return rule.provider;
    }
  }

  // 次に、既知の同期 root を名指しするパスのセグメントを探す。
  for (const raw of path.resolve(dir).split(/[\\/]+/)) {
    const seg = normalizeSegment(raw);
    if (!seg) continue;
    for (const rule of SEGMENT_RULES) {
      if (rule.re.test(seg)) return rule.provider;
    }
  }
  return null;
}

export { cloudSyncProviderOf, SEGMENT_RULES, ENV_RULES };
