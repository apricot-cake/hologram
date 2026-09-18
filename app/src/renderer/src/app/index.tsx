// 単一バンドルのエントリ＝全 React コンポーネントの副作用 import。electron-vite の
// レンダラービルド（electron.vite.config.ts 参照）がこの1本のバレルを Rollup/Vite で
// バンドルするので、共有コード（React・masonic・@base-ui/react・
// _shared/{VirtualGrid,i18n,tip}）はコンポーネントごとに重複せず1回だけバンドルされる。
// （かつては手書きの islands/build.mjs が全 island 分をまとめた IIFE を1つ作っていた＝
// レンダラーが electron-vite へ移ったときに退役。#156 参照。）
//
// レンダラーの React ルートは1つ（最終形 B の DoD:「island のルート群を1つへ統合」＝
// 完了。つまり、かつて独立していた island のルートが1つへ統合された）。root.tsx が
// createRoot(#hologramAppRoot) を1つだけ作って app/App.tsx を描画し、その App.tsx が
// コンポーネントの顔ぶれの正本になる＝どのコンポーネントもその1つのルートの下で描画
// される（コンテナへ載せるものは orchestrator が持つ静的コンテナへ createPortal 経由、
// body 直下のオーバーレイは fixed な子として）。各コンポーネントが持つのは今も描画だけ
// で、状態は renderer/services/*.ts のサービスモジュールから読む＝ロジックと状態、それに
// イベント委譲はすべて orchestrator.ts（viewer.ts から改名）が持つ。それらのサービスが
// モジュール評価時に起こす副作用（購読・初期状態）は、App.tsx が各コンポーネントの
// モジュールを import した副作用として起きる。App.tsx 自身が orchestrator.ts の
// エクスポート（bootApp など）を import すればそのモジュール評価が走るので、このバレル
// に別途の副作用 import は要らない（下の root.tsx 付近の注記を参照）。
//
// 移行は検証可能な単位に分けて進めた: 1=オーバーレイ、2=サイドバー/選択バー/インスペクタ/
// 編集オーバーレイ/検索ボックス、3a=query-chips/image-tab、3b=タブ/ライトボックス、
// 4=設定/ツールバー、5=2つの仮想グリッド（GridMount が flushSync とホストへの取り付けを
// 持ち続ける）。electron-vite の dev サーバーは今やこのファイル自体を ES モジュールとして
// そのまま配る（index.html の <script type="module" src="./src/app/index.tsx"> から参照）
// ＝別のビルド段も書き換えも要らない。
//
// --- レンダラーのサービス層（かつては index.html の個別の <script> タグ、その後は
//     ここに置いた `hologram-svc:NAME` というベア指定子のバレル＝旧 islands/build.mjs や
//     vite.config.mjs が renderer/NAME.ts へエイリアスしていた。その間に、window の IIFE
//     によるグローバルのブリッジから本物の名前付きエクスポートへ、素の相対 import で読む
//     形へと1波ずつ変換していった）。query/listing/format/geometry/posts-data/undo/users/
//     ui/search-editing/confirm/inspector/tag-group-menu/menu/edit-overlay/bridge/
//     filter-popover/qf-pop/facets/about-icon/searchbox/theme/records/tags/tab-state/
//     trash/backup/posts/search/i18n/folders/selection/grid/query-chips/sidebar/tabs は
//     いずれも今や本物の ES モジュールで、使う側が直接 import する＝バレルの項目は要らず、
//     hologram-svc のエイリアス自体もとうに無い。
//     shell.ts＝副作用だけの最後の項目（searchMode の選好の復元）は、検索モードのトグル
//     そのものと一緒に削除した（P2④ 単一のスマート検索）。 ---
// Tailwind v4 と shadcn/ui のテーマ（globals.css）＝いちばん最初に import する。生成される
// スタイルシートがカスケード順でコンポーネント側の CSS より前に来るようにするため。
import '../globals.css';
import './root.tsx';
// 起動のオーケストレータ（services/orchestrator.ts。2026-07-11 に viewer.ts から改名）は、
// もうここで副作用だけの import を要さない＝App.tsx（上の root.tsx 経由で描画される）が
// そのエクスポート（bootApp など）を相対パスで直に import しており、それだけで ES
// モジュールの評価が走る。かつてのベア指定子 'hologram-viewer-bundle' のエイリアスと TS の
// 無視ディレクティブは、このファイルが自前の import/export を持たない素の window IIFE
// だった頃の名残（viewer.ts→orchestrator.ts の改名と一緒に撤去した）。
