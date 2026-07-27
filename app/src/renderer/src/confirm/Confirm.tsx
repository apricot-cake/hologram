import { TriangleAlertIcon } from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { close, get, subscribe as subscribeConfirm } from '../services/confirm.ts';

// Shared confirm modal — shadcn AlertDialog. Callers push a config via confirm.ts's
// open({message, description?, okLabel, cancelLabel, skipLabel?, keyword?, onOk,
// onCancel}); this host renders it. Local state (skip checkbox, keyword value) lives
// here; OK is gated until the keyword matches. The destructive work runs in the
// caller's onOk closure — this only decides when to call it. Esc/Cancel cancel;
// backdrop clicks don't dismiss (AlertDialog semantics — a stray click can't discard
// the decision, unlike the old hand-rolled overlay).

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
        // keyword-gated wipe: the input is the sole focus target the moment the modal opens.
        <Input type="text" autoComplete="off" placeholder={model.keywordPlaceholder} value={kw} onChange={(e) => setKw(e.target.value)} autoFocus />
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>{model.cancelLabel}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={okDisabled} onClick={doOk}>
          {model.okLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

export function ConfirmHost() {
  const m = useSyncExternalStore(subscribe, getSnapshot);
  // Keep the last model around while the dialog animates closed, so the content
  // doesn't blank out mid-exit (m is already null by then).
  const lastRef = useRef<HologramConfirmModel | null>(null);
  if (m) lastRef.current = m;
  const model = m ?? lastRef.current;
  return (
    <AlertDialog
      open={!!m}
      onOpenChange={(open) => {
        if (open) return;
        // Fires for Esc and the Cancel button. doOk closes the bridge first, so
        // get() is already null on that path — don't double-fire onCancel.
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
