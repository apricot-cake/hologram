import { useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { close, get, open as openPrompt, subscribe as subscribePrompt } from '../services/prompt.ts';
import { t } from '../_shared/i18n.ts';

// Shared naming dialog — shadcn Dialog + Input. Callers push a config via prompt.ts's
// open({title, value?, placeholder?, okLabel, cancelLabel, onOk(value), onCancel?});
// this host renders it and owns the input state. OK is disabled while the field is
// blank, so onOk never receives an empty name.
//
// Why this exists at all: window.prompt() throws "prompt() is not supported." in the
// Electron renderer. The naming flows that called it did nothing at all.
//
// Esc and the backdrop cancel (plain Dialog semantics — naming is not a destructive
// decision, so a stray click may dismiss it, unlike ConfirmHost's AlertDialog).

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
      {/* Enter submits: naming is a one-field form, and reaching for the mouse to
          confirm a word you just typed is the thing prompt() got right. */}
      <Input
        type="text"
        autoComplete="off"
        placeholder={model.placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
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
  // Keep the last model while the dialog animates closed, so the content doesn't
  // blank out mid-exit (same reason ConfirmHost holds one).
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

// Convenience wrapper for the common case: "give this a name", OK/cancel.
export function promptName(title: string, value: string, onOk: (v: string) => void) {
  openPrompt({ title, value, okLabel: t('promptOk'), cancelLabel: t('confirmCancel'), onOk });
}
