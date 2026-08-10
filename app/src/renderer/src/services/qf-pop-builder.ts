// 再設計されたフィルタバー向けの値選択ルーティング――引退した qf-pop
// 値フライアウトの、ヘッドレスな残骸。フライアウトの UI（開閉／描画／
// アンカーのハイライト）はそのコンポーネントと共に削除された（P2③
// タスク3）。生き残ったのは onQfPick、選ばれた値を正しい query-builder の
// 変更へ写す追加／削除のルーティング。filterbar コンポーネント
// （filterbar/ValueEditor）は自分の Popover から pickValue() を呼ぶので、
// これは post と poster 両方の木にとって「値が選ばれた→木を変更する」
// ロジックの唯一の出所であり続ける。viewer.ts の分解中に抽出された。
// フライアウト側は 2026-07-18 に引退した。

export interface QfPopDeps {
  postShadow(): { type: string; value?: string; tagId?: number }[];
  posterShadow(): { type: string; value?: string; tagId?: number }[];
  posterQHasValue(type: string, value: string): boolean;
  posterAddFilter(filter: { type: string; [k: string]: any }): void;
  posterRemoveByLeaf(type: string, value: string): void;
  posterRemoveFilter(index: number): void;
  addFilter(filter: { type: string; [k: string]: any }): void;
  removeFilter(index: number): void;
  buildUsers(): HologramUserAgg[];
}

export function makeQfPop(deps: QfPopDeps) {
  // 値選択を正しいビジネスアクションへルーティングする。filterbar の
  // 値エディタからヘッドレスに呼ばれる（開いたフライアウトは無い）――
  // QB の変更自身の refresh() が再描画を駆動するので、ここで再描画すべき
  // ものは何も無い。
  function onQfPick(cat: string, it: HologramQfPopItem) {
    const v = it.v;
    // ポスターのフライアウトはポスタークエリの木の最上位の葉をトグルする。
    // Work/Character/Tag はすべて1つのタグの葉タイプへ写像される（kind は
    // その行がどれを提示するかを絞るだけ）。
    if (cat === 'poster-tag' || cat === 'poster-work' || cat === 'poster-character') {
      // #810: ポスタータグ行も1つの tags テーブル行を表すので、行が id を
      // 持つときはトグルもそれでキー付けする――下の post 側が #774 以来
      // 受けているのと同じ扱いで、query.ts が照合する葉に id が届く唯一の
      // 経路。ラベルは、それが名前以上のことを言うときに一緒に運ばれる
      // （同名の2つの実体は表示上の親でしか見分けがつかない）。
      if (it.tagId != null) {
        // 削除はシャドウの索引を通る。下の post の分岐とまったく同じ:
        // removeFilter は sameLeaf で一致判定し（両側が id を持てば id で）
        // かつ refresh する。素の removeCondsMatching はそれをしない。
        const i = deps.posterShadow().findIndex((f) => f.type === 'tag' && f.tagId === it.tagId);
        if (i >= 0) deps.posterRemoveFilter(i);
        else {
          const label = typeof it.l === 'string' && it.l !== v ? it.l : undefined;
          deps.posterAddFilter(label ? { type: 'tag', value: v, tagId: it.tagId, label } : { type: 'tag', value: v, tagId: it.tagId });
        }
        return;
      }
      if (deps.posterQHasValue('tag', v)) deps.posterRemoveByLeaf('tag', v);
      else deps.posterAddFilter({ type: 'tag', value: v });
      return;
    }
    if (cat === 'poster-platform') {
      if (deps.posterQHasValue('platform', v)) deps.posterRemoveByLeaf('platform', v);
      else deps.posterAddFilter({ type: 'platform', value: v });
      return;
    }
    if (cat === 'poster-instance') {
      if (deps.posterQHasValue('instance', v)) deps.posterRemoveByLeaf('instance', v);
      else deps.posterAddFilter({ type: 'instance', value: v });
      return;
    }
    if (cat === 'poster-folder') {
      // folder は単一値（singleValueTypes）: addFilter が既存のフォルダの葉を置き換える。
      if (deps.posterQHasValue('folder', v)) deps.posterRemoveByLeaf('folder', v);
      else deps.posterAddFilter({ type: 'folder', value: v });
      return;
    }
    const vtype = it.type || cat; // 副行（インスタンス）は type を上書きする
    // #774: タグ行は1つの tags テーブル行を表し、2つが名前を共有すること
    // がある――だからこのトグルのどちらの側も、行が id を持つときはそれで
    // キー付けする。これが無いと、2つ目の「alice」を選んだつもりが1つ目の
    // 葉をトグルしてしまい、id は query.ts が照合する葉に決して届かない。
    const isEntityTag = vtype === 'tag' && it.tagId != null;
    const i = deps.postShadow().findIndex((f) => (isEntityTag ? f.type === 'tag' && f.tagId === it.tagId : f.type === vtype && f.value === v));
    if (i >= 0) {
      deps.removeFilter(i);
    } else if (isEntityTag) {
      // 行のラベルは、それが名前以上のことを言うときに一緒に運ばれる――
      // 同名の2つの実体は表示上の親（「alice(東方)」）でしか見分けが
      // つかず、ただの「alice」というチップが2つ並んでも見分けられない。
      // 下の 'user' の葉と同じ形。tab-state の filterLabel は f.label を
      // 優先する。
      const label = typeof it.l === 'string' && it.l !== v ? it.l : undefined;
      deps.addFilter(label ? { type: 'tag', value: v, tagId: it.tagId, label } : { type: 'tag', value: v, tagId: it.tagId });
    } else if (vtype === 'tag' || vtype === 'hashtag') {
      deps.addFilter({ type: vtype, value: v });
    } else if (vtype === 'user') {
      const u = deps.buildUsers().find((x) => x.key === v);
      deps.addFilter({ type: 'user', value: v, label: u ? u.displayName || u.screenName : v });
    } else {
      deps.addFilter({ type: vtype, value: v });
    }
  }

  // pickValue = 再設計されたフィルタバー（filterbar/）向けに公開された
  // onQfPick: フライアウトを一切介さず、自分の Popover 値エディタから
  // まったく同じ追加／削除のルーティングを駆動する。
  return { pickValue: onQfPick };
}
