import { useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { close, get, subscribe } from '../services/bulk-tag.ts';
import { TagField } from '../inspector/TagField.tsx';

// 今の選択に対する一括のタグ付け（P2⑦）＝選択バーの「タグを追加」。tag-pop の
// mode:'bulk' を置き換えたもの。カード1枚の編集は今やインスペクタでの属性の編集
//（TagField。その場で即座に効く）になったので、残ったタグ付けの流れのうち本当に取引と
// 言えるもの＝一覧を組み立ててから N件の投稿へまとめて書き込むもの＝だけがダイアログを
// 得る。複数選択に対して組み立ててから確定する編集はダイアログにする。
//
// チップとピッカーを描くのはインスペクタが使うのと同じ TagField なので、2つのタグ付けの画面
// は1つの操作感のまま保たれる。違うのはチップの意味だけ。インスペクタではレコードのタグを
// 指すが、ここではこれから追加する一覧を指す＝適用するまで何も書き込まれないし、キャンセル
// や Esc で捨てられる。
//
// 追加しかできない（「N件の投稿のタグを置き換える」UI は無い）。だから注意書きは切り替えでは
// なく説明の中に置いてある。

const getSnapshot = () => get();

function BulkTagBody({ model }: { model: HologramBulkTagModel }) {
  const [tags, setTags] = useState<string[]>([]);
  // 種別の変更（右クリック → 種別）は、組み立て中の一覧に触れないまま語彙の区分けを
  // 変える。だから描き直しを頼むための独自の手段が要る。
  const [, bumpKind] = useReducer((n: number) => n + 1, 0);
  // memo は使わない。このコンポーネントが描き直されるのは、組み立て中のタグが変わった時か、
  // 種別の編集がこれを進めた時だけ＝ちょうどピッカーのデータが変わりうる瞬間に一致する。
  //（入力欄自身のテキストは TagField の状態で、ここまで届かない。）
  const picker = model.pickerData(tags);
  const add = (tag: string) => setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  const remove = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));
  const apply = () => {
    if (!tags.length) return;
    close();
    model.onApply(tags);
  };
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{model.labels.title}</DialogTitle>
        <DialogDescription>{model.labels.additiveHint}</DialogDescription>
      </DialogHeader>
      <TagField tags={tags} vocabGroups={picker.vocabGroups} coocGroups={picker.coocGroups} srcTags={picker.srcTagsForPicker} aliasMap={picker.aliasMap} labels={model.tagLabels} onAdd={add} onRemove={remove} onContextMenu={(tag, x, y) => model.onKindMenu(tag, x, y, bumpKind)} />
      <DialogFooter>
        <Button variant="ghost" onClick={() => close()}>
          {model.labels.cancel}
        </Button>
        {/* 何も組み立てていない＝書き込むものが無い。空の一覧を適用しても何もしないのに、
            「保存した」というトーストだけは出てしまう。 */}
        <Button disabled={!tags.length} onClick={apply}>
          {model.labels.apply}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function BulkTagDialogHost() {
  const m = useSyncExternalStore(subscribe, getSnapshot);
  // 閉じるアニメーションの間、最後のモデルを保持して、本体が途中で真っ白にならないように
  // する（PromptHost・ConfirmHost と同じ）。
  const lastRef = useRef<HologramBulkTagModel | null>(null);
  if (m) lastRef.current = m;
  const model = m ?? lastRef.current;
  return (
    <Dialog
      open={!!m}
      onOpenChange={(open) => {
        if (open) return;
        close(); // Esc・背景・✕＝組み立て中の一覧は本体の中にあり、本体と一緒に消える
      }}
    >
      {model && <BulkTagBody key={model.openId} model={model} />}
    </Dialog>
  );
}
