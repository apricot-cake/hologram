// Form editor for the "+ フィルタ" flow (redesign §3-2 / P2③) — the date-range and
// engagement forms, adapted from the retired filter-popover island. Driven by a
// FilterCatDate / FilterCatEng entry (orchestrator's filterCategories): the entry
// carries the localized dim/type options + the apply action; this component only
// collects the raw field values and hands them off, then closes the popover.
//
// Add-only here (the "+ フィルタ" flow never edits an existing leaf — that's the
// chip-click path, P2③ 後半), so there is no remove button.
import { useEffect, useMemo, useState } from 'react';
import { beginFilterEditSession, endFilterEditSession, type FilterCatDate, type FilterCatEng } from '../services/orchestrator.ts';
import { t } from '../_shared/i18n.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Option = { value: string; label: string };

// Enumerated field as a small Select. `items` must go on the Root: Base UI's
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

function ApplyRow({ onApply }: { onApply: () => void }) {
  return (
    <div className="flex justify-end">
      <Button size="sm" onClick={onApply}>
        {t('qfApply')}
      </Button>
    </div>
  );
}

function DateForm({ cat, onClose }: { cat: FilterCatDate; onClose: () => void }) {
  const [dateField, setDateField] = useState(cat.dimOptions[0]?.value ?? 'date');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const apply = () => {
    cat.apply({ dateField, from, to });
    onClose();
  };
  return (
    <div className="flex w-64 flex-col gap-2 p-2">
      <OptionSelect value={dateField} onChange={setDateField} options={cat.dimOptions} />
      <DateRangeRow from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <ApplyRow onApply={apply} />
    </div>
  );
}

function EngForm({ cat, onClose }: { cat: FilterCatEng; onClose: () => void }) {
  const [engType, setEngType] = useState(cat.typeOptions[0]?.value ?? 'likes');
  const [min, setMin] = useState('');
  const [op, setOp] = useState('gte');
  const opOptions: Option[] = [
    { value: 'gte', label: cat.opGte },
    { value: 'lte', label: cat.opLte },
  ];
  const apply = () => {
    cat.apply({ engType, min, op });
    onClose();
  };
  return (
    <div className="flex w-64 flex-col gap-2 p-2">
      <OptionSelect value={engType} onChange={setEngType} options={cat.typeOptions} />
      <div className="flex items-center gap-1.5">
        <Input type="number" min="0" placeholder="0" className="flex-1" value={min} onChange={(e) => setMin(e.target.value)} />
        <OptionSelect value={op} onChange={setOp} options={opOptions} triggerClassName="shrink-0" />
      </div>
      <ApplyRow onApply={apply} />
    </div>
  );
}

export function FormEditor({ cat, onClose }: { cat: FilterCatDate | FilterCatEng; onClose: () => void }) {
  // One mounted editor = one nav-history entry (#144 確定未決2) — same bracket as
  // ValueEditor (the form applies once, but an edit-reopen replaces in place).
  useEffect(() => {
    beginFilterEditSession();
    return endFilterEditSession;
  }, []);
  return cat.editor === 'date' ? <DateForm cat={cat} onClose={onClose} /> : <EngForm cat={cat} onClose={onClose} />;
}
