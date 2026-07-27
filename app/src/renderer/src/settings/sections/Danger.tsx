import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Hint } from '../components/Hint.tsx';
import { Highlight } from '../components/Highlight.tsx';
import { t } from '../../_shared/i18n.ts';
import { getPrefs } from '../ipc.ts';
import { setSkipDeleteConfirm, confirmClearAll } from '../../../renderer/post-grid-builder.ts';

// 危険な操作: re-enable the delete confirmation + wipe the whole library.
// The wipe is NOT reimplemented here — the button only triggers the shared
// keyword-gated confirm overlay via post-grid-builder.ts's confirmClearAll live binding.
export function Danger() {
  // checked = confirmation is shown (i.e. NOT skipped).
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

      {/* Danger zone card — destructive-tinted border, GitHub-style. */}
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
