# 0014. モーションは CSS を既定とし、View Transitions はグリッド密度切替だけに使う

- 状態: 採用（2026-07-29）
- 関連: #252・#19（棄却リスト）・#154（全面再設計）・[0002](0002-dependency-adoption-criteria.md)・[0003](0003-build-vs-borrow-boundary.md)

## 背景

再設計のモーションは2系統ある。ひとつは CSS（Tailwind の tw-animate-css キーフレームと、Base UI の `data-[state=*]` 属性が駆動する transition）。もうひとつが View Transitions API で、こちらはグリッドの密度切替1箇所でしか使われていなかった。

その1箇所の起動が、撤去予定の層に乗っていた。vanilla の密度モジュールが `document.startViewTransition()` を呼び、そのコールバックの中で vanilla の再描画関数を呼び、それがグローバルブリッジ経由で React の仮想グリッドを `flushSync` で同期描画する — API はコールバック内の**同期的な** DOM 更新しか捕捉しないので、この連鎖の同期性が演出の成立条件そのものだった。#154 の vanilla 層撤去で、演出は黙って消えることになる。

同時に「どの面に何を使うか」が未確定だった。#19 で Motion / react-spring / auto-animate を「View Transitions＋CSS で代替済み」として不採用にしているが、その代替手段の適用範囲が決まっていないと、不採用の根拠自体が宙に浮く。

## 決定

**既定は CSS。View Transitions を使うのは、要素の再配置の前後を補間する必要がある面だけ**とし、v1 ではそれをグリッド密度切替（ギャラリー ⇄ リスト、カード情報の on/off）に限る。

切り分けの物差しは「CSS で書けるか」。単なるフェード・スライド・幅の transition は CSS で足りる。CSS で書けないのは**レイアウトの前後の補間**だけで、密度切替がそれにあたる。

| 面 | 手段 |
| --- | --- |
| グリッド密度切替 | View Transitions |
| クイックビュー（旧ライトボックス）の開閉 | CSS |
| タブ切替 | CSS |
| インスペクタ／サイドバーの開閉 | CSS |

起動は React 側の共通ヘルパ1本（`_shared/view-transition.ts`）に集約し、vanilla 側の起動処理は撤去する。ヘルパが引き受けるのは、この API の失敗が**すべて無言**（例外も console 出力も無く、演出だけが消える）という性質への対処である。

- 更新は `flushSync` の中で行う（React の既定の非同期バッチではコールバックの外に落ちて何も捕捉されない）。
- `prefers-reduced-motion` と API 非対応は起動側で見る。CSS 側の一括短絡（`globals.css` の reduced-motion ブロック）は要素セレクタなので `::view-transition-*` 擬似ツリーに届かない。
- 可視カードに `captureId` 由来の一意な名前を与え、**開始前に DOM 上の重複を検査する**。同一時点で名前が重複すると遷移「全体」が失敗するため。重複した回は演出を捨て、更新だけを通す。
- `::view-transition-*` の duration / easing は既存のモーショントークンを読む（API 既定の 250ms に依存しない）。

**JS モーションライブラリは引き続き入れない。** 再訪条件は、ドラッグの速度をバネの初速へ渡す種類の**ジェスチャ連動**演出を採ると決めたとき。

## 影響

- `app/src/renderer/src/_shared/view-transition.ts`（新規）＝起動の唯一の入口。`app/src/renderer/src/grid/density-transition.ts`（新規）＝密度切替に固有の方針（どのカードに名前を付けるか）。
- `app/src/renderer/src/shell/DisplayMenu.tsx` の密度トグルが起動点になる。`services/grid-density-builder.ts` の `handleViewStoreChange` からは API 呼び出しと `setTimeout` の遅延がなくなり、再描画は同期になる（遅延したままだと再グルーピングがコールバックの外へ落ちる）。
- カードへの名前付けは**遷移中だけ**。常時付けると要素がスタッキングコンテキストを作り、複数画像カードが `z-index:-1/-2` の子で描いている「重なり」がカード自身の背景の裏に沈む。
- `globals.css` のトークン接続は `@layer base` に置く。`index.html` の legacy シートが `#postGrid`／`#tabBar`／`#sidebar`／`.content-activebar`／`#contentTop` を既に名前付けし、それぞれ調整済みの規則（120ms のグリッドフェード、トップレイヤーの下でクロームを固定する `animation: none`）を `animation` ショートハンドで持つ。層を下げないと、無層の longhand がそれらを黙って上書きする。
- **スナップショットは `object-fit: contain`**。カードとリスト行は縦横比が大きく違い、group の箱は遷移中ずっとその中間にある＝スナップショットにどちらの辺を追わせても入れ替えの片側で拡大される。実測で4通り比べ、既定（幅を追う）は古いカードの本文がグリッド全体に拡大、`cover` は大きい方の倍率を取るのでさらに悪化、`height:100%`／`width:auto` は新しいリスト行が同じように拡大した。`contain` だけがどちらの側も自然な大きさを超えない。group は `overflow: clip`。
- **遷移が担っている再描画では、カード入場（`.anim-in`）を出さない**。入場と移動が同時に走ると、2つの動きではなく1つの落ち着かない動きとして読める（legacy シートの元コメント自身が「`anim-in` と二重に動かさない」と宣言していた意図の延長）。判定は「遷移が走行中か」を走行本数のカウンタで見る＝真偽値だと、密度を続けて切り替えた時に1本目の終了が2本目の走行中にフラグを落とす。**演出を諦めた回（reduced-motion・名前の重複・API 不在）ではカウンタを立てない**＝そこで入場まで消すと何も動かなくなる。
- Electron ＝ Chromium 単一環境なのでブラウザ差のフォールバックは不要。一般の Web アプリが JS モーションライブラリを入れる主要動機（View Transitions が無い環境の存在）はここでは発生しない。

## 却下した案

- **React 19 の `<ViewTransition>` コンポーネント**: experimental のため不採用（安定 API のみを使う）。
- **グリッド ⇄ ライトボックスの共有要素遷移**: サムネイルが拡大して開く演出は View Transitions の典型例だが、#154 でライトボックスがクイックビューへ縮退したため、演出そのものの必要度が立たない。
- **タブ・サイドバー・インスペクタへの適用**: 内容の総入れ替えはクロスフェード、パネルは幅の transition で、いずれも CSS で書ける。
- **Motion / react-spring / auto-animate（#19 の棄却の再確認）**: shadcn/ui on Base UI の既定構成が JS モーションライブラリを持たない（CSS キーフレーム＋プリミティブの状態属性）ので、入れる方が上流標準からの逸脱になる。Motion が CSS / View Transitions に対して優位を持つのはレイアウトアニメーション・ジェスチャ連動・複雑なオーケストレーションの3領域で、本決定の適用面はいずれも View Transitions の射程内。
