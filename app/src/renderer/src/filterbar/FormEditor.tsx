//「フィルタ」の流れのためのフォームのエディタ（再設計 §3-2 / P2③）＝期間と反応数の
// フォームで、引退した filter-popover のコンポーネントから移したもの。動かすのは
// FilterCatDate / FilterCatEng の項目（orchestrator の filterCategories）。項目のほうが
// 訳された軸・種別の選択肢と適用の動作を持ち、このコンポーネントは生の欄の値を集めて
// 渡し、ポップオーバーを閉じるだけ。
//
// ここは追加専用（「フィルタ」の流れは既存の葉を編集しない＝それはチップをクリックする
// 経路で、P2③ の後半）。だから削除のボタンは無い。
import { useEffect, useMemo, useState } from 'react';
import { beginFilterEditSession, endFilterEditSession, type FilterCatDate, type FilterCatEng, type FilterCatDim } from '../services/orchestrator.ts';
import { t } from '../_shared/i18n.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Option = { value: string; label: string };

// 列挙の欄を小さな Select で出す。`items` は Root に付けなければならない。そうしないと
// Base UI の Select.Value が生の値の文字列を描いてしまう。
function OptionSelect({ value, onChange, options, triggerClassName = 'w-full' }: { value: string; onChange: (v: string) => void; options: Option[]; triggerClassName?: string }) {
  const items = useMemo(() => Object.fromEntries(options.map((o) => [o.value, o.label])), [options]);
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => {
        if (v != null) onChange(v); // Base UI はクリア時に null を渡す＝ここでは起きない
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

// #162: 軸（幅/高さ/長辺/ファイルサイズ）と、以上／以下と、その軸自身の表示単位での数値
//（前の3つは px、ファイルサイズは MB）。MB から保存されているバイトへの変換は分類の
// apply() が行う。このコンポーネントが扱うのは常に表示単位だけで、上の EngForm と同じ高度。
function DimForm({ cat, onClose }: { cat: FilterCatDim; onClose: () => void }) {
  const [axis, setAxis] = useState(cat.axisOptions[0]?.value ?? 'width');
  const [value, setValue] = useState('');
  const [op, setOp] = useState('gte');
  const opOptions: Option[] = [
    { value: 'gte', label: cat.opGte },
    { value: 'lte', label: cat.opLte },
  ];
  const unit = axis === 'bytes' ? 'MB' : 'px';
  const apply = () => {
    cat.apply({ axis, value, op });
    onClose();
  };
  return (
    <div className="flex w-64 flex-col gap-2 p-2">
      <OptionSelect value={axis} onChange={setAxis} options={cat.axisOptions} />
      <div className="flex items-center gap-1.5">
        <Input type="number" min="0" step={axis === 'bytes' ? '0.1' : '1'} placeholder="0" className="flex-1" value={value} onChange={(e) => setValue(e.target.value)} />
        <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>
        <OptionSelect value={op} onChange={setOp} options={opOptions} triggerClassName="shrink-0" />
      </div>
      <ApplyRow onApply={apply} />
    </div>
  );
}

export function FormEditor({ cat, onClose }: { cat: FilterCatDate | FilterCatEng | FilterCatDim; onClose: () => void }) {
  // 載っているエディタ1つにつき履歴のエントリ1つ（#144 の確定待ちの項目2）＝ValueEditor と
  // 同じ括り（フォームの適用は1回だが、編集で開き直した時はその場で置き換わる）。
  useEffect(() => {
    beginFilterEditSession();
    return endFilterEditSession;
  }, []);
  return cat.editor === 'date' ? <DateForm cat={cat} onClose={onClose} /> : cat.editor === 'eng' ? <EngForm cat={cat} onClose={onClose} /> : <DimForm cat={cat} onClose={onClose} />;
}
