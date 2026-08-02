# 0021. パネルの開閉も即時にする（サイドバー・詳細パネル）

- 状態: 採用（2026-08-02）
- 関連: #583・#245（一括トグル）・[0017](0017-no-grid-motion-view-transitions-retired.md)（同じ物差しをグリッドへ適用した先行決定）・[0018](0018-labeled-navigation-rail-default.md)（収納形＝ラベル付きレール）

## 背景

[0017](0017-no-grid-motion-view-transitions-retired.md) でグリッドのビュー/密度切替はすべて即時になり、View Transitions は撤去された。一方で左サイドバーと右の詳細パネルには shadcn Sidebar 由来の 200ms（幅・位置・レール・グループラベル・行の再成形）と、詳細パネル側の入場アニメ（fade + 18px スライド・`--dur-panel` 0.26s）が残っていた。

#245 の一括トグル（`Ctrl+Shift+B`）はサイドバーを `icon` → `offcanvas` へ切り替えると同時に詳細パネルを閉じるため、**幅の遷移と位置の遷移が重なった状態で実機がくつく**（2026-07-30 実機確認・ユーザー指摘「モーションがちょっとがくつく／モーションいるか？」）。

## 決定

**ドッキングされたパネルの開閉は即時にする。** 一括トグルだけでなく**個別トグルも揃える**（`Ctrl+B`・サイドバーのトリガー・タブ帯の詳細パネルトグル）。

線引きは「レイアウトを動かすか」で引く:

- **即時**＝サイドバー（列の伸縮・オフキャンバス・レール・グループラベル・ナビ行の再成形）と詳細パネル（**ドッキング列と、狭幅時のフローティング形の両方**）。
- **従来どおりモーションを残す**＝ダイアログ的なオーバーレイの出入り（ライトボックス・設定などのモーダル・メニュー・ツールチップ・トリアージ、および 768px 未満で出るモバイル用ドロワー `Sheet`）。これは 0017 が「モーションは CSS（tw-animate のキーフレーム＋Base UI の状態属性 transition）だけになる」と書いた範囲そのままで、今回はそこを削っていない。

個別トグルを揃えた理由:

- **片方だけ止めると一括トグルで再び2つの速度が混ざる。** 一括トグルはマスク（services/panels.ts）で両パネルを同時に伏せる操作なので、片側に 200ms が残っていれば「サイドバーは即・パネルは 0.26s」という食い違いがそのまま一括トグルの見え方になる。
- **同じコントロールが2つの速度を持たない。** 詳細パネルは広幅ではドッキング列・狭幅では同じ要素がフローティングになる。片方だけアニメーションを残すと、同じトグルが幅によって別物に見える。
- **0017 の理由がそのまま当てはまる**＝演出が情報を足さない／切替の速さが体験の中心／失敗しても無言で、監視のためのテスト層を維持し続けることになる。

標準はどうか:

- **VS Code のサイドバー開閉はアニメーション無し**（`workbench.action.toggleSidebarVisibility` は即時）。アニメーションを付けてほしいという要望 [microsoft/vscode#135267](https://github.com/microsoft/vscode/issues/135267) は Backlog Candidates に置かれたまま未実装（2026-08-02 確認）＝**デスクトップシェルの既定は即時**。
- **200ms は fork 元（shadcn/ui の Sidebar）の既定**であって、この面の標準ではない。shadcn はウェブアプリのサイドバーとして書かれており、Hologram は 0018 でその収納形（ラベル付きレール）から既に離れている。
- Explorer / Lightroom などデスクトップの参照群がパネル開閉を即時で行うという認識は 0017 と同じく**未検証**（本決定はそれに寄りかかっていない）。

## 影響

撤去したもの（いずれも「無効化」ではなく削除。半端に残すと次の読者が復活させる）:

- `components/ui/sidebar.tsx`: sidebar-gap の `transition-[width] duration-200 ease-linear`／sidebar-container の `transition-[left,right,width] duration-200 ease-linear`／`SidebarRail` の `transition-all ease-linear`／`SidebarGroupLabel` の `transition-[margin,opacity] duration-200 ease-linear`／`sidebarMenuButtonVariants` の `transition-[width,height,padding]`。
- **ドラッグリサイズ（#30）の `in-data-[resizing=true]:transition-none` 一式**＝アニメーションが無ければドラッグがポインタに遅れようがないので、逃げ道ごと不要になった。連動して `AppShell` の `markResizing`（`data-resizing` の書き込み）と `use-panel-resize.ts` の `onGesture` オプションも削除。
- `AppShell.tsx` の詳細パネル: `duration-[var(--dur-panel)] ease-[var(--ease-out)] animate-in fade-in slide-in-from-right-[18px]`。
- `design-tokens.css` の `--dur-panel`＝唯一の参照が上の1行だったので、トークンごと落とした。

`prefers-reduced-motion` は `globals.css` の全域短絡（全要素の duration を 0.01ms にする1ブロック）のままで、分岐は増えていない＝即時化と矛盾しない。ホバー・フォーカスの `transition-colors` や折りたたみ三角の `transition-transform` は開閉モーションではなくコントロールの微フィードバックなので対象外。

## 却下した案

- **個別トグルだけモーションを残す**: 上の2点（一括トグルで速度が混ざる・同じコントロールが幅で別物に見える）が理由で不採用。残す場合はここに理由を書くと #583 が求めていたが、残す理由の方が見つからなかった。
- **duration を短くする（80ms 等）**: がくつきは2つの遷移が重なる構造から来るので、速くしても重なりは残る。0017 の物差しでは、残す価値は好みに尽きる。
