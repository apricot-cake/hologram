import { useMemo, useState, useSyncExternalStore } from 'react';
import { close, get, subscribe } from '../../renderer/filter-popover.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Commit = (fn?: () => void) => void;
interface FormProps {
  model: CorpusFilterPopoverModel;
  commit: Commit;
}
type Option = { value: string; label: string };

// Date / engagement / poster-date-range filter forms — ONE always-mounted host that
// renders whatever filter-popover.ts's bridge currently holds (or nothing), now on
// the shadcn Popover + form controls. viewer.ts owns the field values (open) +
// apply/remove actions; this island owns the form's local input state (controlled
// inputs). Labels arrive already-localized from viewer (no i18n here);
// numeric/date validation ("apply with nothing entered = no-op") stays in viewer's
// onApply — this component only collects and hands off the raw field values.
//
// The old chip-toggles (投稿日/保存日, ≧/≦) became Selects: two-state cycle buttons
// aren't a shadcn pattern, and a Select states the current choice AND the
// alternative instead of making the user guess what a click would do.

// Enumerated field as a small Select. `items` must be passed to the Root: Base UI's
// Select.Value renders the raw value string otherwise.
function OptionSelect({ value, onChange, options, triggerClassName = 'w-full' }: { value: string; onChange: (v: string) => void; options: Option[]; triggerClassName?: string }) {
  const items = useMemo(() => Object.fromEntries(options.map((o) => [o.value, o.label])), [options]);
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => {
        if (v != null) onChange(v); // Base UI passes null on clear — never our case
      }}
    >
      <SelectTrigger size="sm" className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DateRangeRow({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Input type="date" className="flex-1" value={from} onChange={(e) => onFrom(e.target.value)} />
      <span className="text-xs text-muted-foreground">〜</span>
      <Input type="date" className="flex-1" value={to} onChange={(e) => onTo(e.target.value)} />
    </div>
  );
}

function RemoveApplyRow({ model, commit, onApply }: FormProps & { onApply: () => void }) {
  return (
    <div className="flex justify-end gap-1.5">
      {model.editing && (
        <Button size="sm" variant="destructive" onClick={() => commit(model.onRemove)}>
          {model.labels.removeLabel}
        </Button>
      )}
      <Button size="sm" onClick={() => commit(onApply)}>
        {model.labels.applyLabel}
      </Button>
    </div>
  );
}

function DateForm({ model, commit }: FormProps) {
  const [dateField, setDateField] = useState(model.fields.dateField);
  const [from, setFrom] = useState(model.fields.from);
  const [to, setTo] = useState(model.fields.to);
  const fieldOptions: Option[] = [
    { value: 'date', label: model.labels.typeDate },
    { value: 'capturedAt', label: model.labels.typeCaptured },
  ];
  return (
    <>
      <OptionSelect value={dateField} onChange={setDateField} options={fieldOptions} />
      <DateRangeRow from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <RemoveApplyRow model={model} commit={commit} onApply={() => model.onApply({ dateField, from, to })} />
    </>
  );
}

function EngForm({ model, commit }: FormProps) {
  const [engType, setEngType] = useState(model.fields.engType);
  const [min, setMin] = useState(model.fields.min);
  const [op, setOp] = useState(model.fields.op);
  const opOptions: Option[] = [
    { value: 'gte', label: model.labels.opGte },
    { value: 'lte', label: model.labels.opLte },
  ];
  return (
    <>
      <OptionSelect value={engType} onChange={setEngType} options={model.typeOptions as Option[]} />
      <div className="flex items-center gap-1.5">
        <Input type="number" min="0" placeholder="0" className="flex-1" value={min} onChange={(e) => setMin(e.target.value)} />
        <OptionSelect value={op} onChange={setOp} options={opOptions} triggerClassName="shrink-0" />
      </div>
      <RemoveApplyRow model={model} commit={commit} onApply={() => model.onApply({ engType, min: Number.parseInt(min, 10), op })} />
    </>
  );
}

function PosterDateForm({ model, commit }: FormProps) {
  const [dateField, setDateField] = useState(model.fields.dateField);
  const [from, setFrom] = useState(model.fields.from);
  const [to, setTo] = useState(model.fields.to);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{model.labels.dimLabel}</Label>
        <OptionSelect value={dateField} onChange={setDateField} options={model.dimOptions as Option[]} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{model.labels.rangeLabel}</Label>
        <DateRangeRow from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>
      <RemoveApplyRow model={model} commit={commit} onApply={() => model.onApply({ dateField, from, to })} />
    </>
  );
}

const FORMS = { date: DateForm, eng: EngForm, posterDate: PosterDateForm };

export function FilterPopoverHost() {
  const model = useSyncExternalStore(subscribe, get);

  // Virtual anchor over the bridge's anchorRect — the popup opens programmatically
  // beside a sidebar row, with no trigger element. Base UI positions and
  // viewport-clamps it (the old hand-rolled usePlaceFlyout is gone).
  const anchor = useMemo(() => {
    if (!model) return null;
    const r = model.anchorRect;
    return { getBoundingClientRect: () => new DOMRect(r.left, r.top, r.right - r.left, r.bottom - r.top) };
  }, [model]);

  if (!model) return null;
  const commit: Commit = (fn) => {
    close();
    if (fn) fn();
  };
  const Form = FORMS[model.kind];
  return (
    <Popover
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === 'outside-press') {
          const t = details.event.target as Element | null;
          if (t && t.closest('.sb-row')) return; // the row handler closes-and-reopens itself (avoids a double-close race)
        }
        close();
      }}
    >
      {/* Key on openId: every open() remounts the form, resetting its local input
          state to the bridge's field values — including re-opening the SAME kind
          to edit a different node. */}
      <PopoverContent key={model.openId} anchor={anchor} side="right" align="start" sideOffset={8} collisionPadding={8}>
        <Form model={model} commit={commit} />
      </PopoverContent>
    </Popover>
  );
}
