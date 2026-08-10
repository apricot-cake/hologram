import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Hint } from '../components/Hint.tsx';
import { Highlight } from '../components/Highlight.tsx';
import { t } from '../../_shared/i18n.ts';
import { getPrefs } from '../ipc.ts';
import { setSkipDeleteConfirm, confirmClearAll } from '../../services/post-grid-builder.ts';

// 危険な操作: 削除の確認を有効に戻すことと、ライブラリ全体の全削除。全削除をここで作り直しては
// いない＝ボタンがするのは、post-grid-builder.ts の confirmClearAll の生きた束縛越しに、共用の
// keyword で塞いだ確認のオーバーレイを出すことだけ。
export function Danger() {
  // checked = 確認を出す（つまり省略しない）。
  const [confirmShown, setConfirmShown] = useState(true);

  useEffect(() => {
    Promise.resolve(getPrefs())
      .then((p) => {
        if (p) setConfirmShown(!p.skipDeleteConfirm);
      })
      .catch(() => {});
  }, []);

  const onToggle = (checked: boolean) => {
    setConfirmShown(checked);
    if (setSkipDeleteConfirm) setSkipDeleteConfirm(!checked);
  };

  const clearAll = () => {
    if (confirmClearAll) confirmClearAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Switch id="reset-delete-confirm" checked={confirmShown} onCheckedChange={onToggle} className="mt-0.5" />
        <div className="min-w-0">
          <Label htmlFor="reset-delete-confirm">
            <Highlight text={t('labelResetDeleteConfirm')} />
          </Label>
          <Hint text={t('hintResetDeleteConfirm')} />
        </div>
      </div>

      {/* 「危険な操作」のカード＝破壊的な色を帯びた境界線。GitHub 式。 */}
      <Card className="border-destructive/40">
        <CardContent className="flex justify-start">
          <Button variant="destructive" onClick={clearAll}>
            {t('clearData')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
