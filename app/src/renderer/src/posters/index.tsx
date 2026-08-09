// 仮想化した投稿者グリッドのコンポーネント（services/grid.ts の hologramPosterGridSource）。
// セルの描画・ウィンドウイング・カードの上のジェスチャはすべて React が持ち、posterList と
// 件数の印は今も orchestrator.ts が持ち続ける。ホストの取り付け・取り外しと flushSync の
// 意味論は共用の GridMount（_shared/VirtualGrid.tsx）にある。単一の App のルートの下で
// 描画する（AppShell が <PosterGrid/> を描く）。ソースは押し込まれるのではなく引かれる
// （hologramStore から導く）＝services/grid.ts を参照。
import { GridMount } from '../_shared/VirtualGrid.tsx';
import { PostersHost } from './Posters.tsx';
import { gridSlot, registerGridSlot } from '../services/content-area.ts';
import { hologramPosterGridSource } from '../services/grid.ts';

const container = () => gridSlot('poster');
const setSlot = registerGridSlot('poster');

/**
 * 投稿者の masonry を取り付ける、コンテンツ列の中の箱。もう密度のクラスは持たない
 * （#630）。セルをどの形で描くかは、セル自身が読むモデルから来る＝投稿の側とまったく同じで、
 * 入れ物越しにセルの見た目を決めるものは何も無い。
 */
export function PosterGridSlot({ hidden }: { hidden?: boolean }) {
  return <div ref={setSlot} data-slot="poster-grid" hidden={hidden} />;
}

export function PosterGrid() {
  return <GridMount bridge={hologramPosterGridSource} container={container} renderHost={(model) => <PostersHost model={model} />} />;
}
