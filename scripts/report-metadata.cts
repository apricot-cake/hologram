const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { configDir } = require('../native-host/paths.mts');

const folder = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8')).saveFolder;
const root = path.join(folder, '.hologram-metadata-backfill');
const state = JSON.parse(fs.readFileSync(path.join(root, 'progress.json'), 'utf8'));
const db = new DatabaseSync(path.join(folder, 'hologram.db'), { readOnly: true });
const reasons = {
  protected: '非公開',
  deleted: '削除済み',
  ageRestricted: '年齢制限',
  unknownRestriction: '閲覧制限（理由を特定できず）',
  accessDenied: 'アクセス拒否・ログインが必要な可能性',
  unavailable: '投稿を取得できず（削除とは断定できず）',
  rateLimited: 'レート制限',
  fetchFailed: '通信失敗',
  serverError: 'サーバーエラー',
  unknown: 'APIから投稿情報を取得できず',
};
const counts: Record<string, number> = {};
const rows: any[] = [];
let appliedRecords = 0;
try {
  for (const entry of state.entries) {
    const hash = crypto.createHash('sha256').update(entry.key).digest('hex');
    const receipt = db.prepare('SELECT value FROM store_state WHERE key = ?').get('metadata-backfill:' + hash);
    const status = receipt ? 'applied' : entry.status;
    counts[status] = (counts[status] || 0) + 1;
    if (receipt) appliedRecords += JSON.parse(receipt.value).updated;
    const records = entry.ids.map((id) => db.prepare('SELECT captureId, text, displayName, userId, avatarFile, date, source, image FROM posts WHERE captureId = ?').get(id)).filter(Boolean);
    const missing: string[] = [];
    if (['failed', 'retry'].includes(status)) {
      if (records.some((record) => !record.text)) missing.push('本文');
      if (records.some((record) => !record.displayName)) missing.push('投稿者名');
      if (records.some((record) => !record.userId)) missing.push('投稿者ID');
      if (records.some((record) => !record.avatarFile)) missing.push('アバター');
      if (records.some((record) => !record.date || record.source === 'eagle-migration')) missing.push('正確な投稿日');
      missing.push('APIで取得できる反応数など');
    }
    if (receipt) {
      const cacheFile = path.join(root, 'results', hash + '.json');
      const { result } = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (result.avatar && records.some((record) => !record.avatarFile)) missing.push('アバター画像の取得');
      if (result.media?.length > 1 && records.some((record) => record.image && !db.prepare("SELECT 1 FROM media WHERE postId = ? AND url != ''").get(record.captureId))) missing.push('保存画像が投稿内の何枚目か不明（画像URL・代替テキストは未補完）');
    }
    if (missing.length || ['failed', 'retry'].includes(status))
      rows.push({
        status,
        platform: entry.platform,
        author: entry.author || records[0]?.displayName || '',
        url: entry.url,
        missing: missing.join('、'),
        reason: receipt ? '一部項目の確認が必要' : reasons[entry.reason] || entry.reason || '',
        ids: entry.ids.join(' '),
        retryAt: entry.nextAt ? new Date(entry.nextAt).toISOString() : '',
      });
  }
  for (const item of state.unsupported) rows.push({ status: 'unsupported', platform: item.platform || '', author: item.displayName || '', url: item.url, missing: 'メタデータ補完', reason: '対応する投稿API・投稿URL形式ではない', ids: item.captureId, retryAt: '' });
} finally {
  db.close();
}
const quote = (value) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const csv = [['状態', 'サイト', '投稿者', 'URL', '不足・要確認', '理由', '画像ID', '再試行可能時刻'], ...rows.map((row) => [row.status, row.platform, row.author, row.url, row.missing, row.reason, row.ids, row.retryAt])].map((row) => row.map(quote).join(',')).join('\r\n');
fs.writeFileSync(path.join(root, '要確認.csv'), '\uFEFF' + csv);
const summary = { updatedAt: new Date().toISOString(), total: state.entries.length, counts, appliedRecords, reviewRows: rows.length, unsupported: state.unsupported.length, sites: state.sites };
fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(root, '進捗.md'),
  `# メタデータ補完\n\n更新: ${summary.updatedAt}\n\n対象${summary.total}投稿。反映済み${counts.applied || 0}投稿・${appliedRecords}件。未反映取得済み${counts.fetched || 0}投稿、未取得${(counts.pending || 0) + (counts.fetching || 0)}投稿、再試行${counts.retry || 0}投稿、取得不可${counts.failed || 0}投稿。\n\n要確認は[要確認.csv](./要確認.csv)。APIが取得できない項目と、画像の対応が判断できない項目を記載しています。空欄が本来存在しない値かどうかは断定していません。DOMでのみ取得する値は補完対象外です。\n\n## 再開\n\nリポジトリで順に実行します。取得処理の同時起動は避けてください。\n\n1. \`node scripts/resume-metadata.cts fetch\` — 未取得と再試行可能な投稿を取得。冷却期間は進捗ファイルから引き継ぎます。\n2. \`node scripts/apply-metadata.cts\` — 起動中の対象アプリ経由で取得済みを反映。反映済みはDBの記録からスキップします。\n3. \`node scripts/report-metadata.cts\` — この進捗と要確認リストを更新。\n\nAPI取得結果は results、取得進捗は progress.json、反映前のDBは before-apply.db に保存しています。Eagle経由の履歴、画像、タグ、フォルダー、保存日時は維持します。\n`,
);
console.log(JSON.stringify(summary));
