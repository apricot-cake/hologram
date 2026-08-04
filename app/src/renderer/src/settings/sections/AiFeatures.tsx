import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Hint } from '../components/Hint.tsx';
import { Highlight } from '../components/Highlight.tsx';
import { t } from '../../_shared/i18n.ts';
import { getAiConfig, setAiConfig } from '../../services/ai.ts';

// AI features opt-in gate (#830, parent #98). Off by default: no AI-backed
// feature (tagging/OCR/visual search — #50/#49/#51) runs, and none of their UI
// appears anywhere in the app outside this page, until the switch below is on.
// The disclosure text is the VESSEL #98's transparency principles call for —
// per-model detail (what a specific model does, its training data) is #832's
// model registry to fill in once a model actually exists; this section has
// nothing model-specific to say yet.
export function AiFeatures() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.resolve(getAiConfig())
      .then((c) => setEnabled(!!(c && c.enabled)))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const onToggle = (checked: boolean) => {
    setEnabled(checked);
    Promise.resolve(setAiConfig({ enabled: checked })).catch(() => {
      setEnabled(!checked); // roundtrip failed — the switch must reflect what's actually saved
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Switch id="ai-enabled" checked={enabled} onCheckedChange={onToggle} disabled={!ready} className="mt-0.5" />
        <div className="min-w-0">
          <Label htmlFor="ai-enabled">
            <Highlight text={t('aiEnableLabel')} />
          </Label>
          <Hint text={t('aiEnableHint')} />
        </div>
      </div>

      <Card>
        <CardContent className="space-y-2.5 text-sm">
          <p className="text-muted-foreground">
            <Highlight text={t('aiDisclosureWhat')} />
          </p>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5">
            <li>{t('aiDisclosureNoGenerate')}</li>
            <li>{t('aiDisclosureNoTrain')}</li>
            <li>{t('aiDisclosureLocalOnly')}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
