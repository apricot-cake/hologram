'use strict';

// DB を裏に持つ投稿の一覧について、レンダラーへの差分を作る原始的な部分。
//
// ウィンドウが投稿の全件を持ち、main は動いたものだけを送るので、保存の後の更新は、ライブラリを
// 丸ごと直列化し直す（9千件で約450ms）代わりに小さな IPC のメッセージ1通で済む。「最後に何を
// 届けたか」の状態は main が持つ。ここは純粋な関数のままなので、そのまま単体テストできる。
//
// 刻印は DB から直接取った posts.updatedAt。#302 より前はサイドカーのファイルの mtimeMs だった。
// DB が派生の索引で、生産者が updatedAt を上げずにレコードを編集できたため。今はすべての書き込みが
// DB 自体を通る（writePost は必ず updatedAt を設定する）ので、行自身の刻印が変化の合図であり、
// ファイルシステムの帳簿は一切絡まない。

// lastSent と stamps は captureId → updatedAt。added は新しいか刻印が動いたレコード、removed は
// もう存在しない id。
function computeDelta<T extends { captureId: string }>(lastSent: Map<string, unknown>, posts: T[], stamps: Map<string, unknown>) {
  const added: T[] = [];
  for (const p of posts) {
    if (lastSent.get(p.captureId) !== stamps.get(p.captureId)) added.push(p);
  }
  const removed: string[] = [];
  for (const id of lastSent.keys()) if (!stamps.has(id)) removed.push(id);
  return { added, removed };
}

export { computeDelta };
