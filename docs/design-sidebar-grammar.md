# サイドバー文法統一 — 「絞り込み＝完全な目次」設計・実装プラン

設計: Fable 5（2026-06-12）。実装は別モデル可。
状態: **第1弾・第2弾 実装済み（未コミット）／実機レビューの指摘を受けた A-2（タグ行の
再設計）が設計済み・実装待ち（Sonnet 担当）**。バグ2件（タイトルバードラッグ・
グループ子行フライアウトの検索バー不一致）は修正済み。

> **【更新】ピン留めは 2026-06-20（UX再設計 DQ4・docs/design-ux-redesign-2026-06-20.md）に全廃**。本書のピン留め関連（「ピン留めセクション」・第2弾C「ピン留めの汎化」・サイドバー構成図の `ピン留め` 行）は撤回済みの設計＝経緯として残す。

## 背景（ユーザー指摘）

- 絞り込みセクションは見た目上「何で絞れるかの完全なリスト」を約束しているのに、
  タグ・ハッシュタグが欠けている →「タグはフィルタじゃないの！？」の混乱。
- チップに2つの意味が同居: ピン留めチップ＝押すと即トグル（値）、グループチップ＝
  押すとフライアウトが開く（扉）。角丸6pxで「操作」と区別したつもりだったが、
  チップサイズ・同一フロー内ではその差は読めない。
- 全部クエリビルダーに投入できるのに入口の形がバラバラ＝一貫性がないと感じる。
- （第1弾レビューで追加）グループ名がサイドバーから消えて一覧性が落ちた。
  フライアウトが画面下で見切れる。ピン留めが「タグの」ピン留めだと示されていない →
  むしろ全属性をピン留め対象にすべきでは。

## 原則（実プロダクトの解法）

形を「フィルタかどうか」で統一しない。**層ごとに統一**する:

| 層 | 形 | 操作 |
|---|---|---|
| 属性の入口 | 行（アイコン＋▸）。構造を持つ属性は**インデント子行**を持てる | クリック＝フライアウトで値を選ぶ。**絞り込みセクションに全属性が揃う（完全な目次）** |
| 昇格された値 | ピルチップ（属性グリフ付き） | クリック＝即トグル。ピン留め・ワークスペース・フォルダ |
| 適用中の状態 | クエリビルダーのピル | 全属性がここに合流（既存のまま） |

前例:
- **Linear / Notion** — フィルタメニューは全属性の完全な目次。「プロジェクト」は
  サイドバー（ナビ）とフィルタ属性に二重在籍するが混乱しない（目次が完全だから
  サイドバー側は自然に「ショートカット」と読める）。ビルダーに全部入るのは
  不整合ではなく、そこが統一の場。
- **Notion サイドバー** — 1行に2ターゲット: 名前クリック＝開く、シェブロン＝
  ツリー開閉。タグ行のグループ子行はこれ（Finder/Mail のツリーも同型）。
- **macOS Finder** — 「よく使う項目」＝昇格（promotion）。フォルダでもタグでも
  何でも置ける。ピン留め汎化の前例（Slack のスター・Linear の favorites も同じ）。

## クリック深度

- ピン留め: 1クリック。
- タグ: グループ子行→フライアウト＝2クリック（旧グループチップと同じ）。または
  タグ行→全タグフライアウト（横断検索）＝2クリック。**深さは増えない**。
- グループの開閉（▾）は選択経路の上にない＝畳みたい人だけ畳む。深さに影響しない。

## 変更後のサイドバー構成

```
表示 / 検索 / 並び順         （変更なし）
絞り込み
  取得元 / プラットフォーム / ポストタイプ / メディアタイプ /
  日付 / エンゲージ / 作者 /
  タグ            ▾ ▸  ← 行クリック=全タグフライアウト / ▾=子行の開閉
    人物       12   ▸  ← グループ子行（常設・クリック=そのグループのフライアウト）
    表情        8   ▸
    未分類     23   ▸
  ハッシュタグ        ▸
  フォルダ           ▸
（連続タグ付けボタン）        ← タイトル無しの独立ミニセクション
ピン留め                     ← 全属性の値を昇格可（属性グリフ付きピル・0件で非表示）
ワークスペース / フォルダ     （変更なし＝値ピル/コンテナのショートカット）
```

---

## 第1弾（実装済み・未コミット）

- `index.html`: 絞り込みに タグ/ハッシュタグ/フォルダ 行を追加（`data-qfrow` +
  `data-badge`）。旧タグセクションを「連続タグ付けミニセクション」+「ピン留め
  セクション（`#pinnedSection`・0件で非表示）」に再構成。グループチップ・
  ハッシュタグチップ直置きと `#sbTagGroupRows .sb-chip` CSS を撤去。
- `viewer.js`: `qfValues` の `case 'tag'` をグループ見出し（`qf-ghead`）付き
  全タグリストに書き換え、`case 'hashtag'`（頻度順・上限なし）追加。
  `renderQfPop` が `{ghead}` マーカーを描画・絞り込み入力の件数判定は ghead 除外。
  `hashtag` を `mode:'or'` 分岐へ。`qfTagGroup` 変数と `showQfPopAt` 第3引数を撤去
  （**第2弾で復活させる** — 下記A）。`updateSidebarTags` をピン専用に縮小。
  `updateSidebarHashtags`/`toggleHashtagFilter` 撤去。
- `scripts/test-app-hashtags.js`: タグ行/ハッシュタグ行フライアウト経由に書き換え。
- 同梱の未コミット: `#appBody` の `overflow: hidden` 削除（Phase 1 sticky 回帰修正）。

## 第2弾（承認済み・未実装）

### A. タグ行の下にグループ子行（一覧性の回復）

- `index.html`:
  - タグ行の名前と▸の間に開閉シェブロン `<span class="sb-row-disclosure">▾</span>`。
  - タグ行直後に `<div id="sbTagGroupSubRows"></div>`。
  - CSS: `.sb-subrow` — インデント（行アイコン分≈30px）、12.5px、右端に件数
    （muted数字）と▸。ホバーは `--hover`（行と同じ）。適用中グループは tint文字 or
    バッジ。`.sb-row-disclosure` は開閉で rotate（200ms ease-out・reduced-motion 無効化）。
- `viewer.js`:
  - `showQfPopAt(cat, anchorEl, tagGroupId)` の第3引数と `qfTagGroup` を復活。
    `qfValues('tag')` は `qfTagGroup` 指定時＝そのグループのみのフラットリスト
    （ghead なし）、未指定時＝第1弾の ghead 付き全タグ。`'__other'`＝未分類。
  - `updateSidebarTagGroups()`: tagGroups から子行を描画（存在タグ数・適用中
    ハイライト）。`data-tag-group` 属性。クリック → `showQfPopAt('tag', row, id)`。
  - 外側クリック判定に `[data-tag-group]` を復帰（または子行に `.sb-row` を併用）。
  - シェブロンクリック: `stopPropagation` して開閉トグル。状態は
    `setPref('tagGroupsCollapsed', bool)` で永続化。
- 全タグフライアウトの ghead は維持（横断検索用）。

### B. フライアウトの見切れ修正

- `.qf-pop`（`.fold-menu` 共通でも可）: `display:flex; flex-direction:column;
  max-height: calc(100vh - var(--tabbar-h) - 16px);`、`.qf-vals { overflow-y: auto; }`。
  検索ボックスは flex 先頭で固定＝リストだけ内部スクロール（macOS の長いメニューと同型）。
- 既存の位置クランプ（innerHeight - 8）はそのまま生きる。

### C. ピン留めの汎化（全属性の値を昇格可能に）

- **保存**: `corpus.pinnedTags`（タグ名配列）→ `corpus.pinnedFilters`
  （`[{type, value}]`）。初回ロードで旧キーがあれば `{type:'tag'}` として移行し
  旧キー削除。`loadPins()`/`togglePin(type, value)`/`isPinned(type, value)` に改名。
- **対象**: qfPop を通る値型カテゴリ全部（tag/hashtag/user/platform/instance/
  postType/media/kind/folder）。除外: 日付・エンゲージ（専用ポップ＝そもそも
  qfPop を通らない）、media フライアウトの `__multi`（multiOnly トグルでフィルタ値
  ではない）。ワークスペースは常設チップ済みで対象外。
- **フライアウト側**: ピンアイコンを `qfCat === 'tag'` 限定から全カテゴリへ
  （`__multi` 行のみスキップ）。インスタンス子行は `data-qftype` の型でピン。
- **ピン留めセクション**: チップ＝先頭に属性グリフ（フィルタ行と同じ lucide SVG・
  11px・muted）＋ `filterLabel({type, value})` のラベル。`data-filter-type/value`
  属性は維持（既存の `updateSidebarState` がアクティブ表示を自動処理）。
  クリック＝フライアウト行と同じトグル経路（tag/folder/hashtag は `mode:'or'`、
  user は `buildUsers()` で label 解決）。右クリック＝ピン解除（既存踏襲）。
  表示は「値が現存するもののみ」（tag/hashtag/user/instance/folder は存在チェック、
  platform/postType/media/kind は常に表示）。ピンの保持自体は消さない。
- i18n: `pinnedTags`（ピン留め）・`tipPin` は文言そのままで汎用に通用。

### A-2. タグ行の再設計（第2弾の実機レビュー反映・実装待ち）

第2弾実装後の実機レビューでの指摘（2026-06-12）:

- 行クリック＝全タグフライアウトであることが視覚的に読めない。しかも折りたたみ
  目的で行本体をクリックしがちなので、全タグフライアウトが誤爆してびっくりする。
- ▾（開閉）と ▸（フライアウト）が右端に並んでいて、どっちがどっちか読めない。
- 全タグの横断表示・検索は機能として必要なので、形を変えて残すこと。

解法（実プロダクト準拠）— **2ターゲット1行をやめ、行クリック＝開閉に一本化**:

1. **タグ行クリック＝子行の開閉トグル**（Notion / Mail.app / Finder のセクション
   ヘッダと同型。1行1ターゲットなので誤爆の余地がない）。シェブロン部分の
   クリックも同じ動作＝専用リスナーと `stopPropagation` は不要になる。
   - `filterRows` ハンドラ: `if (cat === 'tag' && tagGroups.length) { hideQfPop();
     toggleTagGroupsCollapsed(); return; }`（`hideQfPop()` は子行由来のフライアウトを
     孤立させないため）。
   - 既存の `sbTagDisclosure` 専用クリックリスナーは**撤去**し、
     `toggleTagGroupsCollapsed()` 関数（collapsed 反転 + localStorage 保存 +
     `updateSidebarTagGroups()`）に置き換える。
     **注意: リスナーを残したまま要素 id を変えると null 参照で起動時に落ちる。**
2. **シェブロンは右端に1個だけ**: `<span class="sb-row-arrow sb-row-disclosure"
   id="sbTagChevron">▾</span>`（▾＝展開中、折りたたみで -90° 回転して他の行と同じ
   ▸ に見える）。
   - `.sb-row-disclosure` は**回転専用モディファイア**に簡素化（見た目は
     `.sb-row-arrow` が担う）: `display:inline-flex; align-items:center;
     transition: transform 200ms ease-out;` ＋ `.collapsed { transform:
     rotate(-90deg); }`。既存定義の flex-shrink/font-size/color/cursor/padding は
     削除。reduced-motion の media query は既存のまま。
3. **全タグの横断検索は子行の先頭「すべてのタグ」行へ**（リストの先頭に「すべて」を
   置く既知パターン。Linear の "All issues" も同じ）。
   - `updateSidebarTagGroups()` の rows 先頭に `data-tag-group="__all"` の子行を
     追加: ラベル `MSG.tagAllRow`・count＝全タグ数・active ハイライトなし
     （グループ行と二重に光らせない。行バッジが適用数を既に示す）。全タグ0件なら出さない。
   - `filterRows` の子行分岐: `showQfPopAt('tag', sub, gid === '__all' ? null : gid)`
     （`null` ＝ 第1弾の ghead 付き全タグリスト＋検索）。
4. **タググループが無いライブラリ**: タグ行は従来どおりプレーン行（クリック＝
   フライアウト、構造の無い属性に子行はない）。`updateSidebarTagGroups()` で
   chevron を静的 ▸ に切り替える（`textContent='▸'`・`collapsed` クラス除去）。
   グループありなら `textContent='▾'`＋collapsed 状態を反映。
5. **i18n**: `tagAllRow` を追加（ja: `すべてのタグ` / en: `All tags`）。
   `i18n.js` の ja は `tagGroupOther: '未分類'` の直後、en は
   `tagGroupOther: 'Uncategorized'` の直後。`viewer.js` の MSG マップにも
   `tagAllRow: _s('tagAllRow'),` を追加（`tagGroupOther` の行の直後）。
6. **テスト**: `test-app-hashtags.js` はタググループ未シードなので現挙動のまま
   PASS（タグ行クリック＝フライアウト）。グループをシードした「行クリック＝開閉・
   __all 行→フライアウト」のアサーション追加は E と合わせて任意。

変更ファイル: `app/renderer/index.html`（タグ行 span 1本化・`.sb-row-disclosure`
CSS 簡素化）、`app/renderer/viewer.js`（filterRows ハンドラ・
`updateSidebarTagGroups`・リスナー→関数化・MSG）、`app/renderer/i18n.js`（ja/en）。

### D. DESIGN.md 追記（実装後）

- IA節: 「絞り込みセクション＝フィルタ可能属性の完全な目次。コンテナ（WS/フォルダ）の
  二重在籍（入口の行＋ショートカットのチップ）は健全（Linear のプロジェクト）」。
- 形の言語: 「値ピルと操作チップを同一チップフローに混在させない（角丸6px の差は
  チップサイズでは読めない・ユーザー指摘）。フライアウトを開く操作は行に。
  構造を持つ属性はインデント子行（Notion/Finder のツリー。名前=開く・▾=開閉の
  2ターゲット1行）」。
- 操作語彙: 「ピン＝任意の値型フィルタの常駐化（Finder よく使う項目/Slack スター/
  Linear favorites）。チップは属性グリフで自己説明」。
- フライアウト: 「ビューポート内 max-height ＋ リスト内部スクロール（検索は上固定）」。
- 却下済み: 「グループチップ（チップ形の扉）」「ハッシュタグチップのサイドバー
  直置き（50件ばらまき）」「ピン留めのタグ限定」。

### E. テスト

- `test-app-hashtags.js`: グループ子行のアサーション追加（tag-groups.json を
  シードして `#sbTagGroupSubRows [data-tag-group]` の件数・クリック→フライアウト）。
- ピン汎化のスモーク（任意・新規 `test-app-pins.js`）: フライアウトでピン →
  ピン留めセクションにチップ出現 → チップクリックでフィルタ適用 → 旧キー移行。

### F. 動作確認（実機）

1. タグ行（A-2 後）: 行クリック＝子行の開閉（永続化）。シェブロンは右端1個で
   開閉に追従して回転。グループが無い保存先では行クリック＝フライアウト＋静的 ▸。
2. グループ子行: 先頭に「すべてのタグ」（クリックで ghead 付き全タグフライアウト
   ＋検索）、以下グループ行（件数表示・クリックでそのグループのフライアウト）。
3. 長いフライアウトが画面内に収まり内部スクロールする（検索ボックス固定）。
4. ハッシュタグ/作者など任意のフライアウトでピン → ピン留めにグリフ付きチップ。
   クリックでトグル・右クリックで解除・旧 pinnedTags が移行されている。
5. タブタイトル・ビルダー・バッジへの反映（既存ロジック）。
