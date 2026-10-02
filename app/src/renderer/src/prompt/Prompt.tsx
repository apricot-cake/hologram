import { useRef, useState, useSyncExternalStore } from 'react';
import { isComposing } from '../_shared/composition.ts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { close, get, open as openPrompt, subscribe as subscribePrompt } from '../services/prompt.ts';
import { t } from '../_shared/i18n.ts';

// 共用の名前入力ダイアログ＝shadcn の Dialog と Input。呼び出し側が prompt.ts の
// open({title, value?, placeholder?, okLabel, cancelLabel, onOk(value), onCancel?}) で
// 設定を押し込み、このホストが描画して入力の状態を持つ。欄が空の間は OK を無効にするので、
// onOk が空の名前を受け取ることはない。
//
// そもそもこれがある理由: Electron のレンダラーでは window.prompt() が
// "prompt() is not supported." を投げる。それを呼んでいた名前付けの流れは、まったく何も
// しない状態だった。
//
// Esc と背景で取り消しになる（素の Dialog の意味論＝名前付けは破壊的な判断ではないので、
// ConfirmHost の AlertDialog と違い、うっかりのクリックで閉じてよい）。

const subscribe = (cb: () => void) => subscribePrompt(cb);
const getSnapshot = () => get();

function PromptContent({ model }: { model: HologramPromptModel }) {
  const [value, setValue] = useState(model.value ?? '');
  const okDisabled = !value.trim();
  const doOk = () => {
    if (okDisabled) return;
    close();
    model.onOk(value.trim());
  };
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{model.title}</DialogTitle>
      </DialogHeader>
      {/* Enter で確定する: 名前付けは欄が1つだけのフォームで、いま打ったばかりの語を
          確定するのにマウスへ手を伸ばさせない点こそ prompt() が正しかったところ。 */}
      <Input
        type="text"
        autoComplete="off"
        placeholder={model.placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (isComposing(e.nativeEvent)) return;
          if (e.key === 'Enter') doOk();
        }}
        autoFocus
      />
      <DialogFooter>
        <Button variant="ghost" onClick={() => close()}>
          {model.cancelLabel}
        </Button>
        <Button disabled={okDisabled} onClick={doOk}>
          {model.okLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function PromptHost() {
  const m = useSyncExternalStore(subscribe, getSnapshot);
  // ダイアログが閉じるアニメーションの間、最後のモデルを持ち続ける＝退場の途中で中身が
  // 空にならないようにする（ConfirmHost が1つ持っているのと同じ理由）。
  const lastRef = useRef<HologramPromptModel | null>(null);
  if (m) lastRef.current = m;
  const model = m ?? lastRef.current;
  return (
    <Dialog
      open={!!m}
      onOpenChange={(open) => {
        if (open) return;
        const cur = get();
        if (!cur) return;
        close();
        cur.onCancel?.();
      }}
    >
      {model && <PromptContent key={model.openId} model={model} />}
    </Dialog>
  );
}

// よくある場合＝「これに名前を付ける」と OK・キャンセル、のための簡便なラッパー。
export function promptName(title: string, value: string, onOk: (v: string) => void) {
  openPrompt({ title, value, okLabel: t('promptOk'), cancelLabel: t('confirmCancel'), onOk });
}
