// シード付きシャッフル順序（#118）――「ランダム」の投稿ソート。この順序は
// 配列に対する一発の Fisher-Yates ではない: (seed, レコードキー) の純粋
// 関数なので、同じシードは再ソート、増分更新、仮想化された再描画、タブ
// 復元をまたいで同じ順序を再現し、入力順には決して依存しない。作り直しは
// シードを置き換えることを意味し、それ以外は何もしない。
//
// シードはタブごとのスナップショット（tabs-builder）に乗るので、復元
// されたタブは持っていた順序を表示する。依存が無い純粋なモジュールで、
// listing パイプラインが直接 import する（単体テストも Node 上で単独で
// 読み込む）。

// FNV-1a（32ビット）。小さく、依存が無く、短い ASCII のキーに対してよく
// 分散する――ソートの比較関数が必要とするのはそれだけ。これは順序付けで
// あって暗号化ではない。
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32ビット空間での h *= 16777619（Math.imul は 2^31 を超えても正確に保つ）。
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 1つのシードの下での、1レコード分の比較用キー。
export const shuffleRank = (seed: string, key: string): number => fnv1a(seed + '|' + key);

// 新しいシード。選ばれる値さえ違えばどんな文字列でもよい。永続化された
// タブ状態の中で読みやすいままでいられるよう短くしておく。
export const newShuffleSeed = (): string => Math.random().toString(36).slice(2, 10);
