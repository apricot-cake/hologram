// 直近に Eagle へ保存されたアイテムの url と annotation を一覧する手動テスト補助。
// C7 (複数画像ドラッグ) の検証用: ドラッグ後に実行し、N 枚すべてに annotation が
// 付いたか / Image: 行が正しいか / url が素の permalink に正規化されたかを目視確認する。
//
// 使い方:
//   node scripts/check-recent-annotations.mjs              直近 12 件
//   node scripts/check-recent-annotations.mjs 30           直近 30 件
//   node scripts/check-recent-annotations.mjs 30 x         直近 30 件のうち x.com の url を持つものだけ
//   node scripts/check-recent-annotations.mjs 30 x 1780000000000
//       さらに mtime が指定 epoch(ms) 以降のものだけ (= ベースライン以降の新規ドラッグ分のみ)。
//       同一投稿の古い保存分が混じって件数集計が紛れるのを防ぐ。
//
// Eagle デスクトップが起動している必要がある (ローカル REST API localhost:41595)。

const EAGLE_API = 'http://localhost:41595';
const limit = Number(process.argv[2]) || 12;
const filterHost = process.argv[3] || null; // 'x' / 'bsky' / 'pixiv' 等の部分一致
const sinceMs = Number(process.argv[4]) || 0; // この epoch(ms) 以降に変更された item のみ

const res = await fetch(`${EAGLE_API}/api/item/list?limit=${limit}`, {
  headers: { 'Content-Type': 'application/json' }
}).catch((e) => {
  console.error(`Eagle API へ接続できません (${e.message})。Eagle が起動しているか確認してください。`);
  process.exit(1);
});
const json = await res.json();
if (json.status !== 'success') {
  console.error('Eagle API error:', JSON.stringify(json));
  process.exit(1);
}

let items = json.data;
if (filterHost) items = items.filter((it) => (it.url || '').includes(filterHost));
if (sinceMs) items = items.filter((it) => (it.mtime || 0) >= sinceMs);

const sinceNote = sinceMs ? ` / ${new Date(sinceMs).toLocaleString('ja-JP')} 以降` : '';
console.log(`直近 ${json.data.length} 件中 ${items.length} 件を表示${filterHost ? ` (url に "${filterHost}")` : ''}${sinceNote}\n`);

for (const it of items) {
  const when = new Date(it.mtime).toLocaleString('ja-JP');
  const ann = (it.annotation || '').trim();
  const hasAnn = ann ? '✅' : '⬜';
  console.log(`${hasAnn} ${it.id}  [${when}]`);
  console.log(`   url: ${it.url || '(none)'}`);
  if (ann) {
    for (const line of ann.split('\n')) console.log(`   | ${line}`);
  } else {
    console.log('   | (annotation 空)');
  }
  console.log('');
}

// C7 向けサマリ: 同一 postId (x.com/<user>/status/<id>) を共有するグループごとに
// 何枚 annotation 付与済みかを集計する。
const groups = new Map();
for (const it of items) {
  const m = (it.url || '').match(/(x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/);
  if (!m) continue;
  const key = m[2];
  if (!groups.has(key)) groups.set(key, { total: 0, annotated: 0 });
  const g = groups.get(key);
  g.total++;
  if ((it.annotation || '').trim()) g.annotated++;
}
if (groups.size) {
  console.log('--- X 投稿グループ別 annotation 付与状況 (C7) ---');
  for (const [postId, g] of groups) {
    const ok = g.annotated === g.total ? '✅' : '⚠️ ';
    console.log(`${ok} status/${postId}: ${g.annotated}/${g.total} 枚に annotation`);
  }
}
