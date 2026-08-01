import { useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { close, get, subscribe } from '../services/bulk-tag.ts';
import { TagField } from '../inspector/TagField.tsx';

// Bulk tagging for the current selection (P2⑦) — the selection bar's "Add tag".
// It replaces tag-pop's mode:'bulk': a single-card edit is now a property edit in
// the inspector (TagField, inline and immediate), so the one tagging flow left that
// is genuinely a *transaction* — stage a list, then write it to N posts at once —
// is the one that gets a Dialog. Staged-then-committed edits over a multi-item
// selection are dialogs in Linear/GitHub/Gmail too.
//
// The same TagField the inspector uses draws the chips and the picker, so the two
// tagging surfaces stay one interaction. The difference is only what the chips
// mean: in the inspector they are the record's tags, here they are the list about
// to be added — nothing is written until Apply, and Cancel/Esc discards.
//
// Additive is the only mode (there is no "replace the tags of N posts" UI), which
// is why the hint sits in the description rather than being a switch.

const getSnapshot = () => get();

function BulkTagBody({ model }: { model: HologramBulkTagModel }) {
  const [tags, setTags] = useState<string[]>([]);
  // A kind change (right-click → kind) re-sections the vocabulary without touching
  // the staged list, so it needs its own way to ask for a redraw.
  const [, bumpKind] = useReducer((n: number) => n + 1, 0);
  // No memo: this component re-renders only when the staged tags change or a kind
  // edit bumps it — exactly the moments the picker data can differ. (The input's
  // own text is TagField's state and never reaches here.)
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
      <TagField tags={tags} vocabGroups={picker.vocabGroups} coocGroups={picker.coocGroups} srcTags={picker.srcTagsForPicker} labels={model.tagLabels} onAdd={add} onRemove={remove} onContextMenu={(tag, x, y) => model.onKindMenu(tag, x, y, bumpKind)} />
      <DialogFooter>
        <Button variant="ghost" onClick={() => close()}>
          {model.labels.cancel}
        </Button>
        {/* Nothing staged = nothing to write; applying an empty list would be a
            no-op that still fires a "saved" toast. */}
        <Button disabled={!tags.length} onClick={apply}>
          {model.labels.apply}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function BulkTagDialogHost() {
  const m = useSyncExternalStore(subscribe, getSnapshot);
  // Hold the last model through the close animation so the body doesn't blank
  // out mid-exit (same as PromptHost/ConfirmHost).
  const lastRef = useRef<HologramBulkTagModel | null>(null);
  if (m) lastRef.current = m;
  const model = m ?? lastRef.current;
  return (
    <Dialog
      open={!!m}
      onOpenChange={(open) => {
        if (open) return;
        close(); // Esc / backdrop / ✕ — the staged list lived in the body and dies with it
      }}
    >
      {model && <BulkTagBody key={model.openId} model={model} />}
    </Dialog>
  );
}
