// "同一人物にする" picker (#23 St1) — searches the named-poster list and hands the
// pick back to poster-grid-builder.ts's onPick (which runs the confirm gate +
// the actual merge). Same shell as the command palette (CommandPalette.tsx):
// Base UI Autocomplete's `inline` mode inside a shadcn Dialog — reused rather
// than adopting a second searchable-list primitive (that file's own header
// comment records why cmdk/a custom overlay were rejected for this app).
import { Autocomplete } from '@base-ui/react/autocomplete';
import { useState, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { close, get, subscribe, type HologramAliasPickerCandidate } from '../services/alias-picker.ts';

function PickerBody({ model }: { model: import('../services/alias-picker.ts').HologramAliasPickerModel }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const items = q ? model.candidates.filter((c) => c.label.toLowerCase().includes(q) || c.sub.toLowerCase().includes(q)) : model.candidates;

  const pick = (c: HologramAliasPickerCandidate) => {
    close();
    model.onPick(c.key);
  };

  return (
    <DialogContent className="top-[15%] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-md">
      <DialogHeader className="sr-only">
        <DialogTitle>{model.title}</DialogTitle>
      </DialogHeader>
      <Autocomplete.Root inline open mode="none" items={items} value={query} onValueChange={setQuery} autoHighlight="always" itemToStringValue={(c: HologramAliasPickerCandidate) => c.label}>
        <div className="border-b border-border p-1">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{model.title}</div>
          <Autocomplete.Input autoFocus placeholder={model.placeholder} className="h-8 w-full min-w-0 border-0 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm" />
        </div>
        <Autocomplete.List className="max-h-80 overflow-y-auto overscroll-contain p-1">
          {(c: HologramAliasPickerCandidate) => (
            <Autocomplete.Item key={c.key} value={c} onClick={() => pick(c)} className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none data-highlighted:bg-muted">
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {c.sub && <span className="shrink-0 text-xs text-muted-foreground">{c.sub}</span>}
            </Autocomplete.Item>
          )}
        </Autocomplete.List>
        <Autocomplete.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:hidden">{model.emptyLabel}</Autocomplete.Empty>
      </Autocomplete.Root>
    </DialogContent>
  );
}

export function AliasPickerHost() {
  const m = useSyncExternalStore(subscribe, get);
  return (
    <Dialog
      open={!!m}
      onOpenChange={(open) => {
        if (open) return;
        const cur = get();
        close();
        cur?.onCancel?.();
      }}
    >
      {m && <PickerBody key={m.openId} model={m} />}
    </Dialog>
  );
}
