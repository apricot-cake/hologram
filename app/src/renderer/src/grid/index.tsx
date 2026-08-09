// 仮想化した投稿グリッドのコンポーネント（services/grid.ts の hologramPostGridSource）＝
// 投稿の2つのレイアウト（グリッド・一覧、#618）の両方について、セルの描画と
// 仮想化を持つ。ホストの取り付け・取り外しと flushSync の意味論は共用の
// GridMount（_shared/VirtualGrid.tsx）にある。単一の App のルートの下で描画する
// （AppShell が <PostGrid/> を描く）。ソースは押し込まれるのではなく引かれる
// （hologramStore から導く）＝services/grid.ts を参照。
import { GridMount } from '../_shared/VirtualGrid.tsx';
import { GridHost } from './Grid.tsx';
import { gridSlot, registerGridSlot } from '../services/content-area.ts';
import { hologramPostGridSource } from '../services/grid.ts';

// モジュールのスコープに置く: GridMount はこの同一性が変わるたびに取り付けの effect を
// 走らせ直すし、React はコールバックの同一性が変わった ref を外して取り付け直す。
const container = () => gridSlot('post');
const setSlot = registerGridSlot('post');

/** masonry を取り付ける、コンテンツ列の中の箱。 */
export function PostGridSlot({ hidden }: { hidden?: boolean }) {
  return <div ref={setSlot} data-slot="post-grid" hidden={hidden} />;
}

export function PostGrid() {
  return <GridMount bridge={hologramPostGridSource} container={container} renderHost={(model) => <GridHost model={model} />} />;
}
