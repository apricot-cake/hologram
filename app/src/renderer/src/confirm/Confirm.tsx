import { CircleHelpIcon, FolderIcon, FolderInputIcon, ImageIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  const [option, setOption] = useState(model.optionDefault === true);
  const [kw, setKw] = useState('');
  const okDisabled = model.keywordRequired != null && kw.trim() !== model.keywordRequired;
  const doOk = () => {
    if (okDisabled) return;
    close();
    model.onOk({ skip, option });
  };
  const doAlt = () => {
    close();
    model.onAlt?.({ skip });
  };
  const HeaderIcon = model.icon === 'folder' ? FolderInputIcon : model.icon === 'help' ? CircleHelpIcon : TriangleAlertIcon;
  const hasImportPreview = model.optionPreviewItems != null;
  return (
    <AlertDialogContent className={hasImportPreview ? 'min-w-0 !w-[calc(100%-2rem)] !gap-5 !p-5 sm:!max-w-md' : 'min-w-0'}>
      <AlertDialogHeader className="!block">
        <div className="flex items-center gap-4">
          <AlertDialogMedia className="mb-0 !size-6 shrink-0 !bg-transparent">
            <HeaderIcon className="size-6" />
          </AlertDialogMedia>
          <div className="min-w-0 space-y-1">
            <AlertDialogTitle>{model.message}</AlertDialogTitle>
            {model.description != null && <AlertDialogDescription>{model.description}</AlertDialogDescription>}
          </div>
        </div>
      </AlertDialogHeader>
      {model.skipLabel != null && (
        <Label className="justify-start font-normal text-muted-foreground">
          <Checkbox checked={skip} onCheckedChange={(v) => setSkip(v === true)} />
          {model.skipLabel}
        </Label>
      )}
      {model.optionLabel != null && (
        <div className="min-w-0 space-y-2">
          <Label className="justify-start !font-normal !text-foreground">
            <Checkbox checked={option} onCheckedChange={(v) => setOption(v === true)} />
            {model.optionLabel}
          </Label>
          {option && model.optionDescription != null && <AlertDialogDescription className="!font-normal !text-foreground">{model.optionDescription}</AlertDialogDescription>}
          {option && model.optionDetails != null && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {model.optionDetails.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
          {option && model.optionPreviewItems != null && (
            <div className="pt-2">
              <ScrollArea className="h-52 min-w-0 max-w-full overflow-hidden rounded-md border bg-muted/30">
                <ul className="min-w-0 divide-y">
                  {model.optionPreviewItems.map((item, index) => (
                    <li key={`${item.section}-${item.label}-${item.description}`}>
                      {item.section != null && item.section !== model.optionPreviewItems?.[index - 1]?.section && (
                        <div className="flex min-w-0 items-center gap-2 bg-muted/50 px-3 py-2 text-sm text-foreground">
                          <FolderIcon className="size-4 text-muted-foreground" />
                          <span className="truncate">{item.section}</span>
                        </div>
                      )}
                      <div className="flex min-w-0 items-center gap-3 px-7 py-2">
                        {item.imageSrc ? (
                          <img src={item.imageSrc} alt="" className="size-11 shrink-0 rounded-md object-cover" />
                        ) : (
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <ImageIcon className="size-5" />
                          </div>
                        )}
                        <div className="min-w-0 text-sm">
                          <div className="flex min-w-0 items-center gap-1.5 text-foreground">
                            <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{item.label}</span>
                          </div>
                          <p className="mt-0.5 text-foreground">{item.description}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}
        </div>
      )}
      {model.loading === true && (
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
        </div>
      )}
      {model.keywordPlaceholder != null && (
        // keyword で塞いだ全削除: モーダルが開いた瞬間、フォーカスの当たる先はこの入力欄だけ。
        <Input type="text" autoComplete="off" placeholder={model.keywordPlaceholder} value={kw} onChange={(e) => setKw(e.target.value)} autoFocus />
      )}
      <AlertDialogFooter className={hasImportPreview ? '!-mx-5 !-mb-5 !border-t-0 !bg-transparent !p-5' : undefined}>
        <AlertDialogCancel>{model.cancelLabel}</AlertDialogCancel>
        {!model.loading && model.altLabel != null && (
          <AlertDialogAction variant="secondary" onClick={doAlt}>
            {model.altLabel}
          </AlertDialogAction>
        )}
        {!model.loading && (
          <AlertDialogAction variant={model.okDestructive === false ? 'default' : 'destructive'} disabled={okDisabled} onClick={doOk}>
            {model.okLabel}
          </AlertDialogAction>
        )}
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
