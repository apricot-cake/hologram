// ドラッグ → Eagle item のマッチングロジック (純粋関数)。
// background.js のポーリングから切り出して Node テスト可能にした。
// ここには chrome / fetch / DOM への依存を一切持たせない (URL とプレーンオブジェクトのみ)。
//
// 背景: 複数画像を続けてドラッグしたとき「N 枚中 1 枚しか annotation が付かない」回帰が
// あった (pendingDrags 単一スロット上書き)。キュー化 + consumed セットで全枚数を別 item に
// 割り当てる現行ロジックを、回帰テストで固定するためにここへ分離した。

// Eagle item の更新時刻がドラッグ時刻からこれ以上前なら、別の (無関係な) item とみなす。
export const MATCH_WINDOW_MS = 30000;

// eagleUrl と candidateUrl が「同じ投稿/画像を指す」かを判定する。
// 完全一致のほか、同一ホストでパス境界での前方一致を許す
// (/status/123 は /status/123/photo/1 にマッチ、/status/12 は /status/123 にマッチしない)。
export function urlMatches(eagleUrl, candidateUrl) {
  if (!eagleUrl || !candidateUrl) return false;
  if (eagleUrl === candidateUrl) return true;

  try {
    const a = new URL(eagleUrl);
    const b = new URL(candidateUrl);

    if (a.hostname === b.hostname) {
      if (a.pathname === b.pathname) return true;

      // パス境界での前方一致: /status/123 は /status/123/photo/1 にマッチするが
      // /status/12 は /status/123 にマッチしない
      const shorter = a.pathname.length <= b.pathname.length ? a.pathname : b.pathname;
      const longer = a.pathname.length > b.pathname.length ? a.pathname : b.pathname;
      if (longer.startsWith(shorter) && (longer[shorter.length] === '/' || shorter.endsWith('/'))) {
        return true;
      }
    }
  } catch {}
  return false;
}

// candidateUrls のいずれかに一致する、未消費かつドラッグ時刻近傍の item を 1 つ返す。
// consumed は同 tick で既に別ドラッグへ割り当て済みの item id 集合。
function matchByUrls(items, candidateUrls, dragTime, consumed) {
  if (!candidateUrls.length) return null;
  for (const item of items) {
    if (consumed.has(item.id)) continue;
    // 既に注釈が入っている item は対象外: 別ドラッグが付けた注釈を上書きせず、再マッチもしない。
    // SW 再起動で下記 claimed 集合が消えた後でも、書き込み済み注釈を読み返して二重マッチを防ぐ保険。
    if (item.annotation && String(item.annotation).trim()) continue;
    const itemTime = item.modificationTime || item.lastModified || 0;
    if (itemTime < dragTime - MATCH_WINDOW_MS) continue;
    const itemUrl = item.url || '';
    if (!itemUrl) continue;
    for (const candidateUrl of candidateUrls) {
      if (urlMatches(itemUrl, candidateUrl)) return item;
    }
  }
  return null;
}

// 1 ドラッグ (entry) に対応する Eagle item を探す。consumed は同 tick で既に割り当て済みの item id。
// pass1: 画像固有 URL (画像ごとに異なる) → 物理画像と item を正しく対応付けられる
// pass2: 投稿/ページ URL (同一投稿の N 枚で共通) → consumed 除外で別 item を割り当てる
export function findMatchingItem(items, entry, consumed) {
  const imageUrls = (entry.imageUrls || []).filter(Boolean);
  const postUrls = [entry.pageUrl, entry.metadata?.link].filter(Boolean);
  return matchByUrls(items, imageUrls, entry.timestamp, consumed)
    || matchByUrls(items, postUrls, entry.timestamp, consumed);
}

// 1 ポーリング tick 分: pendingDrags を Eagle item 群へ割り当てる。
// 同一投稿の N 枚が同じ投稿 URL を共有していても、consumed セットで毎回別 item を取るので
// 全枚数に annotation が付く。
//
// claimed: 過去の poll tick で既に Info+ が注釈した item id の集合 (background SW がセッション中保持)。
// これを consumed の初期値としてシードすることで、poll をまたいでも一度割り当てた item を
// 別ドラッグが再マッチ (上書き) しない。これが無いと: 注釈済み item は url が素の permalink に
// 正規化され、同一投稿の後続ドラッグが pass2 (投稿 URL) でその item に再マッチ → 1 枚に集中し、
// (とくに自分の item がまだ未作成のタイミングで) 新規 item が取り残される = 実機 N 枚中 1 枚バグ。
// claimed は変更しない (コピーをシード)。確定した割り当ては呼び出し側が claimed に追加する。
// 返り値は適用すべき [{ entry, itemId }] の配列 (ドラッグ順)。
export function selectMatches(items, pendingDrags, claimed = new Set()) {
  const consumed = new Set(claimed);
  const matches = [];
  for (const entry of pendingDrags) {
    const matched = findMatchingItem(items, entry, consumed);
    if (matched) {
      consumed.add(matched.id);
      matches.push({ entry, itemId: matched.id });
    }
  }
  return matches;
}
