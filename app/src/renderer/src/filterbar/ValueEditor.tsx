// 「絞り込みを追加」の流れのための値の編集画面（再設計 §3-2 / P2③）＝ファセット1カテゴリ
// 分のチェックリスト、あるいはセクション付きタグの2ペインの選択器。退役した qf-pop
// コンポーネントの本体を手直ししたもの＝buildRows/buildGroups/ValueRow の描画も、セクション
// 付きタグ（種別: 作品/キャラ/未分類）の2ペインも同じで、駆動するのが qf-pop のブリッジでは
// なく FilterCatValues の項目（orchestrator の filterCategories）になっている。選択器は開いた
// ままにして、値を続けて何個も切り替えられるようにする。選ぶたびに values() を読み直すので、
// on と件数が更新される。
//
// 旧来の exact/loose の検索モードのセグメントは無くなった（保留事項の4番、再度の改訂＝
// 単一のスマート検索）。絞り込みの入力欄は素の部分一致（先頭の @ で投稿者のスクリーンネーム
// に限定する。これだけは残す価値のある約束事）＝共有の検索モジュールのモードを副作用で
// 切り替えることはもうしない。
import { CheckIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { beginFilterEditSession, endFilterEditSession, type FacetMode, type FilterCatValues, type FilterRow } from '../services/orchestrator.ts';
import { includesNormalized } from '../services/search.ts';
import { t } from '../_shared/i18n.ts';
import { kindDotClass } from '../_shared/kind-dot.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ファセットの演算子と除外のモード（再設計 §4-2 B）。複数値を取るファセット（タグ/ハッシュタグ/フォルダ）は どれか/すべて/〜以外 の
// 3択を出し、それ以外の値のファセットは どれか/〜以外 の2択を出す（クラスタにならない型では
// 「すべて」は意味を成さない）。語彙は全体で1つに揃える（どれか/すべて/〜以外）＝セグメント
// とチップのモードの語が同じに読めるように。片方を選ぶと setMode がファセットを書き換える。
function ModeSeg({ cat, mode, onPick }: { cat: FilterCatValues; mode: FacetMode; onPick: (m: FacetMode) => void }) {
  const opts: { m: FacetMode; label: string }[] = cat.multi
    ? [
        { m: 'or', label: t('qbOptAny') },
        { m: 'and', label: t('qbOptAll') },
        { m: 'exclude', label: t('fbModeExclude') },
      ]
    : [
        { m: 'or', label: t('qbOptAny') },
        { m: 'exclude', label: t('fbModeExclude') },
      ];
  return (
    <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
      {opts.map((o) => (
        <button key={o.m} type="button" className={cn('flex-1 rounded px-2 py-0.5 text-xs', mode === o.m ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} onClick={() => onPick(o.m)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Row = { type: 'div' } | { type: 'ghead'; text: string } | { type: 'row'; item: FilterRow };
type Group = { name: string; items: FilterRow[] };

// 項目を平らにして描画用の一覧にし、グループの見出しか、在る↔無いの区切り線1本を差し込む
// （平らな facetDim の一覧のときだけ。グループ付き・固定の一覧は順序をそのまま保つ）。
function buildRows(items: FilterRow[]): Row[] {
  const hasGhead = items.some((it) => it.ghead != null);
  const out: Row[] = [];
  let sawPresent = false;
  let dividerDone = false;
  for (const it of items) {
    if (!hasGhead && !dividerDone && it.facetDim && it.count === 0 && sawPresent) {
      out.push({ type: 'div' });
      dividerDone = true;
    }
    if (it.facetDim && (it.count as number) > 0) sawPresent = true;
    out.push(it.ghead != null ? { type: 'ghead', text: it.ghead } : { type: 'row', item: it });
  }
  return out;
}

// 平らな項目をセクションへ割る（ghead がセクションを開き、次の ghead までの行がその中身）。
// ghead が1つも無ければ [] を返す（→ 平らなレイアウト）。
function buildGroups(items: FilterRow[]): Group[] {
  const groups: Group[] = [];
  let cur: Group | null = null;
  for (const it of items) {
    if (it.ghead != null) {
      cur = { name: it.ghead, items: [] };
      groups.push(cur);
    } else if (cur) cur.items.push(it);
  }
  return groups;
}

// 種別の色の点。仕事はホバーしたときにその色の名前を言うことだけなので、素の span を
// ツールチップで包んである（トリガーのボタンは無い＝クリックは下の行が持つ）。
function KindDot({ kind, title }: { kind: string; title: string }) {
  const dot = <span className={kindDotClass(kind)} />;
  if (!title) return dot;
  return (
    <Tooltip>
      <TooltipTrigger render={dot} />
      <TooltipContent side="top">{title}</TooltipContent>
    </Tooltip>
  );
}

// 値の行1つ。どちらのレイアウトも共有する。件数0の行も選べるままにして、色で落とす。
function ValueRow({ it, onPick }: { it: FilterRow; onPick: (it: FilterRow) => void }) {
  const sub = !!it.sub;
  const off = !!(it.facetDim && it.count === 0);
  return (
    <div className={cn('flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm select-none hover:bg-accent hover:text-accent-foreground', sub && 'pl-6 text-xs', (sub || off) && 'text-muted-foreground')} onClick={() => onPick(it)}>
      {it.kind ? <KindDot kind={it.kind as string} title={(it.dotTitle as string) || ''} /> : null}
      <span className="min-w-0 flex-1 truncate">{it.l as string}</span>
      {it.count != null ? <span className={cn('shrink-0 text-xs tabular-nums', off ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{it.count as number}</span> : null}
      {it.on ? <CheckIcon className="size-4 shrink-0" /> : null}
    </div>
  );
}

export function ValueEditor({ cat, onManage }: { cat: FilterCatValues; onManage: (fn: () => void) => void }) {
  // 載っている編集画面1つ＝ナビゲーション履歴1件（#144 の確定済み保留事項2）。載せている
  // 間を括ることで、このセッション中のどの選択も最初の選択が積んだ1件へ合流する。
  // 親がカテゴリごとに key を振るので、カテゴリを切り替えればセッションも始め直しになる。
  useEffect(() => {
    beginFilterEditSession();
    return endFilterEditSession;
  }, []);
  // 選ぶたびに values() を読み直し、on と件数がその場で変わった木を映すようにする。
  // 親がカテゴリごとにこれを載せ直すので（key=cat）、遅延初期化がそのまま読み直しになる。
  const [items, setItems] = useState<FilterRow[]>(cat.values);
  // モードは選択をまたいで残る UI 上の意図（載せた時点で生きている木から入れる）。
  // 〜以外 のモードでは新しく選んだ値が肯定として入るので、ファセット全体が除外のままに
  // なるよう否定を掛け直す（setMode は既に否定済みの値に対しては何度実行しても同じ）。
  const [mode, setMode] = useState<FacetMode>(cat.mode());
  const pick = (it: FilterRow) => {
    cat.pick(it);
    if (mode === 'exclude') cat.setMode('exclude');
    setItems(cat.values());
  };
  // 上のモードと同じく、載せた時点で生きている木から入れる（編集画面はカテゴリごとに
  // key が振られているので、載せ直しがそのまま読み直しになる）。
  const [only, setOnly] = useState(() => !!cat.only?.get());
  const applyOnly = (v: boolean) => {
    cat.only?.set(v);
    setOnly(v);
    setItems(cat.values());
  };
  const applyMode = (m: FacetMode) => {
    cat.setMode(m);
    setMode(m);
    setItems(cat.values());
  };

  const [query, setQuery] = useState('');
  const [groupSel, setGroupSel] = useState(-1); // -1 は全部、それ以外は groups への添字
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!cat.showFind) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [cat.showFind]);

  const groups = useMemo(() => buildGroups(items), [items]);
  const twoPane = groups.length > 0;
  const rows = useMemo(() => buildRows(items), [items]);
  const allTags = useMemo(() => groups.flatMap((g) => g.items).sort((a, b) => ((b.count as number) || 0) - ((a.count as number) || 0) || String(a.l).localeCompare(String(b.l), 'ja')), [groups]);

  // 単一のスマートな照合＝素の部分一致（先頭の @ でスクリーンネーム sn に限定する）。
  const raw = query.trim();
  const atMode = raw.startsWith('@');
  const q = atMode ? raw.slice(1) : raw;
  const filtering = !!q;
  const hit = (hay: unknown) => includesNormalized(hay, q);
  const matchItem = (it: FilterRow) => !filtering || (atMode ? hit(it.sn) : hit(it.l));
  const visible = rows.filter((r) => (r.type !== 'row' ? !filtering : matchItem(r.item)));
  const paneItems = (groupSel < 0 ? allTags : groups[groupSel] ? groups[groupSel].items : []).filter(matchItem);

  return (
    <div className={cn('flex max-h-(--available-height) flex-col gap-2 p-2', twoPane ? 'w-max max-w-[min(520px,calc(100vw-24px))]' : 'w-64')}>
      <ModeSeg cat={cat} mode={mode} onPick={applyMode} />
      {/* フォルダのファセットだけ（#41）。モードのセグメントの隣に置くのは、これが条件に
          どの値が入るかではなく条件の意味そのものを決めるから＝フォルダは、これが別のことを
          言わない限り配下のフォルダも含む。4つ目のセグメントではなくスイッチにしたのは、
          どれか/すべて/〜以外 と直交していて3つのどれとも組み合わさるから。 */}
      {cat.only ? (
        <label className="flex cursor-default items-center justify-between gap-2 px-1 text-xs select-none">
          <span>{t('foldOnly')}</span>
          <Switch checked={only} onCheckedChange={applyOnly} />
        </label>
      ) : null}
      {cat.showFind ? <Input ref={inputRef} type="text" className="h-7 text-xs" placeholder={t('qfFindPh')} autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} /> : null}
      {twoPane ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-28 max-w-48 shrink-0 overflow-y-auto border-r border-border pr-1 [scrollbar-gutter:stable]">
            <button type="button" className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs', groupSel < 0 ? 'bg-accent font-semibold text-accent-foreground' : 'hover:bg-muted')} onClick={() => setGroupSel(-1)}>
              <span className="min-w-0 flex-1 truncate text-left">{t('qfAllTags')}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{allTags.length}</span>
            </button>
            {groups.map((g, gi) => (
              <button key={gi} type="button" className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs', groupSel === gi ? 'bg-accent font-semibold text-accent-foreground' : 'hover:bg-muted')} onClick={() => setGroupSel(gi)}>
                <span className="min-w-0 flex-1 truncate text-left">{g.name}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{g.items.length}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 min-w-[150px] flex-1 overflow-y-auto pl-1 [scrollbar-gutter:stable]">{paneItems.length === 0 ? <div className="px-2 py-1.5 text-muted-foreground">—</div> : paneItems.map((it, i) => <ValueRow key={i} it={it} onPick={pick} />)}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          {visible.filter((r) => r.type === 'row').length === 0 ? (
            <div className="px-2 py-1.5 text-muted-foreground">—</div>
          ) : (
            visible.map((r, i) => {
              if (r.type === 'div') return <div key={i} className="mx-1.5 my-1 h-px bg-border" />;
              if (r.type === 'ghead')
                return (
                  <div key={i} className="pointer-events-none mt-1 border-t border-border px-1.5 pt-2 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground first:mt-0 first:border-t-0 first:pt-1">
                    {r.text}
                  </div>
                );
              return <ValueRow key={i} it={r.item} onPick={pick} />;
            })
          )}
        </div>
      )}
      {cat.manage ? (
        <div className="shrink-0 border-t border-border pt-1">
          <Button variant="ghost" size="sm" className="w-full justify-start text-primary" onClick={() => onManage(cat.manage as () => void)}>
            {cat.manageLabel || t('ctxManage')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
