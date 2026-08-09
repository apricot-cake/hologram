// ピン留めアイテムの構築（#79）: 「このカード」や「この投稿」がピン留め
// ミニビューアの集合に何を提供するか。意図して、カード自身のサムネイルが
// すでに表示している唯一の表紙ファイル（densityImage の規則――
// post-grid-builder.ts の cardMenuItems が「フォルダに表示」「画像を
// コピー」に使うのと同じもの）だけを対象にする。複数画像の投稿の全ページ
// ではない: ピン留めウィンドウは軽量な参照集合であって2つ目のギャラリー
// ではなく、「1枚をピン」という設計は、1回の右クリックで黙って十数枚の
// タイルへ膨れ上がるべきではない。
import { densityImage, isVideoFile } from './records.ts';
import type { PinItem } from '../../../main/ipc-payloads.ts';

export function pinItemOfPost(p: HologramPost): PinItem | null {
  const file = densityImage(p) || p.image || '';
  if (!file) return null;
  return { captureId: p.captureId || '', file, video: isVideoFile(file) };
}

export function pinItemOfGroup(g: HologramPostGroup): PinItem | null {
  return pinItemOfPost(g.rep);
}

/**
 * カードメニューの「複数選択対応」（#79 導線①）: `groups` の各グループは
 * 最大でも1枚のタイルになり、ファイルで重複除去される（2つの異なる選択を
 * 通して到達できる同じ投稿が二重にならないように）。どのグループが対象と
 * なるかは呼び出し側が決める――post-grid-builder.ts の onCardMenuPick
 * 参照。これは dragFilesOf の「クリックされたカードが選択に含まれていれば
 * 選択が優先される」規則を鏡写しにしている。
 */
export function pinItemsOfGroups(groups: HologramPostGroup[]): PinItem[] {
  const seen = new Set<string>();
  const out: PinItem[] = [];
  for (const g of groups) {
    const it = pinItemOfGroup(g);
    if (it && !seen.has(it.file)) {
      seen.add(it.file);
      out.push(it);
    }
  }
  return out;
}
