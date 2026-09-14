// 購読できる投稿データの service＝「allPosts が変わった」の1つの通り道で、他の service や
// コンポーネントが、viewer.js の押し込み経由でしか allPosts に届かない状態を抜け出せる。
// allPosts 自体は viewer.js の `let` のまま（一覧・グループ化・絞り込みの流れにまたがる
// 44か所の読み取りがあり、所有権を丸ごと移すのはここの範囲外で、要らない危険を負う）。これは
// users.js や tags.js が allPosts について既に取っているのと同じ形を写したもの＝viewer 自身の
// 状態を指す、注入された getter の閉包であって、それを所有する service ではない。get() は
// 今の参照を返す（追加や削除では新しい配列、その場での編集では同じ参照＝タグの編集のような
// 内容だけの変化では、「何かが変わったから読み直す」だけを知りたい使い手に、新しい配列は
// 要らない）。sync() は markPostsMutated() から呼ぶ。あれが元から、allPosts のあらゆる
// 書き換えの唯一の通り道（viewer.ts を参照）。本物の ES モジュール（名前付きの export）で、
// 使う側（viewer.ts / sidebar.ts / image-tab.ts）が直接 import する。
import { PostRecordInputSchema } from '../../../../../native-host/post-schemas.mts';
let posts: HologramPost[] = [];
const quoted = new Map<string, HologramPost>();
export function getQuotedPost(id: string): HologramPost | undefined {
  return quoted.get(id);
}
export function getQuotedPosts(): HologramPost[] {
  return [...quoted.values()];
}
let generation = 0;
const subs = new Set<() => void>();
const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 無視する */
    }
  }
};
export function get(): HologramPost[] {
  return posts;
}
export function sync(next: HologramPost[]): void {
  posts = next;
  quoted.clear();
  for (const p of next) {
    const q = p.quotedPost;
    if (q?.captureId) quoted.set(q.captureId, { ...PostRecordInputSchema.parse({ ...q, platform: p.platform, captureId: q.captureId }), capturedAt: p.capturedAt, updatedAt: p.updatedAt, tagIds: [] } as HologramPost);
  }
  generation++;
  notify();
}
export function getGeneration(): number {
  return generation;
}
export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
