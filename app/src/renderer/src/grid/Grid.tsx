// 仮想化した投稿グリッド＝共有の VirtualGridHost に載せる投稿用のセル（masonic と
// スクロール周りの配線は _shared/VirtualGrid.tsx が持つ）。このコンポーネントが持つのは
// セルの描画と窓の制御で、データ（model.items = viewGroups）とセルが呼び返す操作は
// orchestrator.ts が持つ。
//
// 行なのかカードなのかはモデルの表示の形から決まる（#618）＝グリッドは1つ、レイアウトは
// 2つ、2本目のコンポーネントの木も、CSS で決めるコンテナのクラスも無い。
import { useSyncExternalStore } from 'react';
import { FeedCard } from '../_shared/FeedCard.tsx';
import { ListRow } from '../_shared/ListRow.tsx';
import { PostCard } from '../_shared/PostCard.tsx';
import { useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import { SectionedGridHost } from '../_shared/SectionedGrid.tsx';
import { selectionClickBackground, selectionMarquee } from '../services/orchestrator.ts';
import { store, subscribeKey } from '../services/store.ts';

// modelOf() は描画のたびに生きている viewer の状態を読み直すので、供給側の描き直しで
// 見えているセルが更新される。詳細表示のリングと選択はそのクロージャ読みのモデルには
// 入っていない＝どちらも hologramStore から直に導く（'inspectedKey' / 'selectedSet' の
// 本物の購読）ので、詳細パネルを開いても選択を切り替えても、描き直しなしで当該のセルが
// 再描画される。
const subInspected = (cb: () => void) => subscribeKey('inspectedKey', cb);
const getInspected = () => store.getState().inspectedKey;
const subSelected = (cb: () => void) => subscribeKey('selectedSet', cb);
const getSelected = () => store.getState().selectedSet;

export function PostCell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const inspectedKey = useSyncExternalStore(subInspected, getInspected);
  const selectedSet = useSyncExternalStore(subSelected, getSelected);
  const shape = model.shape as HologramGridModel['shape'];
  const m = model.modelOf(data, index);
  m.inspected = inspectedKey != null && !!model.keyOf && model.keyOf(data, index) === inspectedKey;
  m.selected = selectedSet.has(m.postKey);
  // #183: タイムラインのモードは、下のグリッド/リストの判定より先に自分の3つ目のセルを
  // 選ぶ＝shape.list は今も投稿モード自身のレイアウトの選好が最後に何だったかを持って
  // いる（2つの軸は独立。DisplayMenu.tsx の TimelineControls 参照）ので、それがこの
  // 分岐へ漏れてはいけない。
  if (model.mode === 'timeline') return <FeedCard m={m} shape={shape as NonNullable<typeof shape>} group={data} actions={model.cardActions} onAspect={model.onAspect} />;
  if (shape?.list) return <ListRow m={m} shape={shape} group={data} actions={model.cardActions} listThumb={model.listThumb} />;
  return <PostCard m={m} shape={shape as NonNullable<typeof shape>} overview={model.overview} group={data} actions={model.cardActions} onAspect={model.onAspect} />;
}

// ドラッグによる範囲選択（#484）＝選択を持つグリッドはここだけなので、マーキーを構える
// のもここだけ。遅らせて束縛するのは FloatingBar が一括操作を呼ぶのと同じ作り＝
// orchestrator は selectionMarquee を init のときに代入し、それはこのモジュールが import
// されたよりずっと後になる。ここでは同一性が安定していることが効く＝この prop が変わる
// たびにホストはジェスチャを畳んで構え直す。
const marqueeSink: HologramMarqueeSink = {
  begin: (additive) => selectionMarquee.begin(additive),
  update: (indices) => selectionMarquee.update(indices),
  end: () => selectionMarquee.end(),
  cancel: () => selectionMarquee.cancel(),
};

// 同じ押下のクリック側（#242）＝余白のクリックで選択を消す。遅らせて束縛し、描画の外へ
// 引き上げてあるのは上の sink と同じ理由。
const onBackgroundClick = () => selectionClickBackground();

export function GridHost({ model }: { model: HologramGridModel }) {
  // nav: 選択が動き回るのはこのグリッドなので、列数とスクロールの幾何を
  // services/grid-nav.ts へ公開する（投稿者グリッドは選択を持たない）。
  // anchor: そして Ctrl+ホイールのズームが位置を保つのもこのグリッド（#282）＝投稿者
  // グリッドのズームの経路はノッチごとに確定させ、位置を保つことはない。
  //
  // #47: 日付ソートはグリッドを月のセクションへまとめる（post-grid-builder.ts /
  // date-sections.ts）＝当てはまるとき model.sections がそのまとまりを持つ。他のどの
  // ソート・ブラウズモードでもそこは null か不在のままで、単一インスタンスの
  // VirtualGridHost を通す描画は一切変わらない。
  // #183: タイムラインはまず本文として読まれる＝そこでのドラッグはマーキーによる選択では
  // なく文字列の選択（2026-08-02 の設計コメントの受け入れ条件8）。sink を渡さない
  // （何もしない関数を渡すのではない）ことでジェスチャを根元から無効にする＝
  // VirtualGridHost と SectionedGridHost がマーキーを構えるのは `marquee` がそもそも
  // 在るときだけ（_shared/VirtualGrid.tsx 参照）。クリックによる選択・詳細パネル・
  // コンテキストメニューは変わらない＝どれもこの prop を通らない。
  const marquee = model.mode === 'timeline' ? undefined : marqueeSink;
  if (model.sections && model.sections.length) {
    return <SectionedGridHost model={model} cell={PostCell} nav anchor marquee={marquee} onBackgroundClick={onBackgroundClick} />;
  }
  return <VirtualGridHost model={model} cell={PostCell} nav anchor marquee={marquee} onBackgroundClick={onBackgroundClick} />;
}
