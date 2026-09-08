import type { Translate } from './translation.ts';
// タグ種別（Kind）メニューの行／アクションビルダー――旧 viewer.ts の
// モノリスから抽出。ガラスのポップアップ自体（open/close/get/subscribe）は
// すでに kind-menu.ts にある――このモジュールは、以前は viewer.ts に
// インラインであった view 固有の接着剤: 今の種別の状態から work/character/
// general の行モデルを組み立て、選択／改名のアクションを tags.ts の
// ミューテータへ配線する。tagKindOf/kindLabel/t は引き続き viewer.ts 自身の
// makeTags()/i18n の配線が持つので、deps として注入される――
// query-builder.ts と同じ ctx パターン。
import { open as kindMenuOpen } from './kind-menu.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { setTagKind, setKindLabel } from './tags.ts';
import { notify } from './ui.ts';

export interface KindMenuDeps {
  tagKindOf: (tagId: number | null | undefined) => string | null;
  tagKindOfName: (tag: string) => string | null;
  /** name → tags テーブルの id。読み込み済みのすべて（投稿＋ポスタータグ）にわたって。 */
  tagIdOf: (name: string) => number | undefined;
  kindLabel: (kind: string) => string;
  t: Translate;
}

export function makeKindMenu(deps: KindMenuDeps) {
  const { tagKindOf, tagKindOfName, tagIdOf, kindLabel, t } = deps;

  // タグチップ（編集ピッカー／インスペクタ／ポスター）を右クリックして
  // Work/Character/General に分類する。タグの種別はそのタグ自身の属性
  // （投稿には一切触れない）で、タグ編集の中で静かな段階的開示のエントリ
  // として表に出す。描画は専用の kind-menu React コンポーネントにある
  // （行の選択対象とその改名ボタンは独立した2つのクリック対象で、汎用の
  // ContextMenu の項目の形にはそれを収める余地が無い）。ここが持つのは
  // 行モデルの組み立てと、kind-menu.ts 経由の選択／改名アクションの実行
  // だけ。
  // #810: 種別は1つの tags 行にぶら下がり、チップは名前しか運ばない――
  // だから呼び出し元は、自身のデータが実体を名指ししている場合はそれを
  // 渡す（検査中の投稿の並行する tagIds）。それ以外はすべて、名前を
  // 読み込み済みのものに照らして解決する。2つの実体が名前を共有していて、
  // このチップがどちらなのか誰にも言えないときは、解決側の最初のヒットが
  // 答えになる。それは書き込み経路自身がその名前に対して選ぶのと同じタグ
  // （lib-db-write.ts の tagResolver）。
  function showKindMenu(tag: string, x: number, y: number, onChanged?: (() => void) | null, entityId?: number | null) {
    const tagId = entityId != null ? entityId : (tagIdOf(tag) ?? null);
    const cur = tagId != null ? tagKindOf(tagId) : tagKindOfName(tag);
    // work/character の対は、種別をグローバルに改名する静かな ✎ を運ぶ
    // （段階的開示: ここ、タグ管理の種別メニューだけ）。
    const row = (k: string, label: string) => ({ kind: k, label, dot: !!k, checked: (k || null) === cur, renameable: k === 'work' || k === 'character' });
    kindMenuOpen({
      x,
      y,
      header: t('tagKindHeader'),
      renameTitle: t('tagKindRename'),
      rows: [row('work', kindLabel('work')), row('character', kindLabel('character')), { sep: true }, row('', t('kindGeneral'))],
      async onPick(kind) {
        if ((cur || '') === kind) return; // すでにその種別――書き込み不要
        if (tagId == null) {
          notify(t('tagKindUnknown'));
          return;
        }
        await setTagKind(tagId, kind);
        if (onChanged) onChanged();
        notify(kind ? t('tagKindSet', { name: kindLabel(kind) }) : t('tagKindCleared'));
      },
      onRename(kind) {
        promptName(t('tagKindRenamePrompt'), kindLabel(kind), async (next) => {
          await setKindLabel(kind, next);
          if (onChanged) onChanged();
          notify(t('tagKindRenamed'));
        });
      },
    });
  }

  return { showKindMenu };
}
