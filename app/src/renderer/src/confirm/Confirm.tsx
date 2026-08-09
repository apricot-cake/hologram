import { TriangleAlertIcon } from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { close, get, subscribe as subscribeConfirm } from '../services/confirm.ts';

// 共用の確認モーダル＝shadcn の AlertDialog。呼び出し側が confirm.ts の
// open({message, description?, okLabel, cancelLabel, skipLabel?, keyword?, onOk,
// onCancel}) で設定を押し込み、このホストがそれを描画する。ローカルの状態（skip の
// チェックボックス、keyword の値）はここが持つ。OK は keyword が一致するまで塞ぐ。
// 破壊的な処理は呼び出し側の onOk のクロージャで走る＝ここが決めるのはいつ呼ぶかだけ。
// Esc と Cancel は取り消し、背景のクリックでは閉じない（AlertDialog の意味論＝以前の
// 手作りのオーバーレイと違い、うっかりのクリックで判断を捨てられない）。

const subscribe = (cb: () => void) => subscribeConfirm(cb);
const getSnapshot = () => get();

function ConfirmContent({ model }: { model: HologramConfirmModel }) {
  const [skip, setSkip] = useState(false);
  const [kw, setKw] = useState('');
  const okDisabled = model.keywordRequired != null && kw.trim() !== model.keywordRequired;
  const doOk = () => {
    if (okDisabled) return;
    close();
    model.onOk({ skip });
  };
  const doAlt = () => {
    close();
    model.onAlt?.({ skip });
  };
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogMedia>
          <TriangleAlertIcon />
        </AlertDialogMedia>
        <AlertDialogTitle>{model.message}</AlertDialogTitle>
        {model.description != null && <AlertDialogDescription>{model.description}</AlertDialogDescription>}
      </AlertDialogHeader>
      {model.skipLabel != null && (
        <Label className="justify-center font-normal text-muted-foreground">
          <Checkbox checked={skip} onCheckedChange={(v) => setSkip(v === true)} />
          {model.skipLabel}
        </Label>
      )}
      {model.keywordPlaceholder != null && (
        // keyword で塞いだ全削除: モーダルが開いた瞬間、フォーカスの当たる先はこの入力欄だけ。
        <Input type="text" autoComplete="off" placeholder={model.keywordPlaceholder} value={kw} onChange={(e) => setKw(e.target.value)} autoFocus />
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>{model.cancelLabel}</AlertDialogCancel>
        {model.altLabel != null && (
          <AlertDialogAction variant="secondary" onClick={doAlt}>
            {model.altLabel}
          </AlertDialogAction>
        )}
        <AlertDialogAction variant={model.okDestructive === false ? 'default' : 'destructive'} disabled={okDisabled} onClick={doOk}>
          {model.okLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

export function ConfirmHost() {
  const m = useSyncExternalStore(subscribe, getSnapshot);
  // ダイアログが閉じるアニメーションの間、最後のモデルを持ち続ける＝退場の途中で中身が
  // 空にならないようにする（その時点で m はすでに null）。
  const lastRef = useRef<HologramConfirmModel | null>(null);
  if (m) lastRef.current = m;
  const model = m ?? lastRef.current;
  return (
    <AlertDialog
      open={!!m}
      onOpenChange={(open) => {
        if (open) return;
        // Esc と Cancel ボタンで発火する。doOk は先にブリッジを閉じるので、その経路では
        // get() がすでに null＝onCancel を二重に発火させない。
        const cur = get();
        if (!cur) return;
        close();
        cur.onCancel?.();
      }}
    >
      {model && <ConfirmContent key={model.openId} model={model} />}
    </AlertDialog>
  );
}
