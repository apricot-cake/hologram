import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Hint } from '../components/Hint.tsx';
import { Highlight } from '../components/Highlight.tsx';
import { t } from '../../_shared/i18n.ts';
import { notify } from '../../services/ui.ts';
import { getAiConfig, setAiConfig } from '../../services/ai.ts';
import { deleteModel, downloadModel, getModelList, onModelDownloadProgress } from '../../services/models.ts';
import type { ModelDownloadProgress, ModelInfo } from '../../../../main/ipc-payloads.ts';

// AI features opt-in gate (#830, parent #98). Off by default: no AI-backed
// feature (tagging/OCR/visual search — #50/#49/#51) runs, and none of their UI
// appears anywhere in the app outside this page, until the switch below is on.
// The disclosure text is the VESSEL #98's transparency principles call for;
// the model list below (#832) is the per-model detail that vessel left open —
// what each model's license is, and the get/delete controls the transparency
// principle "the user can fully undo it" points at.

function fmtBytes(n: number): string {
  if (!n) return '0 MB';
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// The preload's onModelDownloadProgress bridge attaches a fresh ipcRenderer
// listener on every call with no remover, and this component remounts each
// time Settings opens — so the underlying IPC listener is wired exactly ONCE
// and fans out to the live React subscriber set (same pattern Data.tsx's
// wireIpcOnce uses for save-folder-progress/backup-done).
const progressSubs = new Set<(p: ModelDownloadProgress) => void>();
let ipcWired = false;
function wireIpcOnce() {
  if (ipcWired) return;
  ipcWired = true;
  try {
    onModelDownloadProgress((p) => progressSubs.forEach((cb) => cb(p)));
  } catch {
    /* bare dev server: no preload bridge behind hologramIpc */
  }
}

function ModelRow({ model, progress, busy, onDownload, onDelete }: { model: ModelInfo; progress: ModelDownloadProgress | null; busy: boolean; onDownload: () => void; onDelete: () => void }) {
  const bytesDone = progress ? progress.bytesDone : model.bytesDone;
  const pct = model.bytesTotal ? Math.min(100, Math.floor((bytesDone / model.bytesTotal) * 100)) : 0;
  return (
    <div className="space-y-2 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-xs break-all">{model.id}</div>
          <div className="text-muted-foreground text-xs">{model.licenseNote}</div>
          {model.state === 'absent' && model.installedRev && <div className="text-muted-foreground text-xs">{t('modelUpdateAvailable')}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {model.state === 'complete' ? (
            <>
              <span className="text-muted-foreground text-xs">{t('modelStateComplete')}</span>
              <Button variant="ghost" size="sm" onClick={onDelete} disabled={busy}>
                {t('modelDelete')}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={onDownload} disabled={busy}>
              {busy ? t('modelDownloading') : model.state === 'partial' ? t('modelResume') : t('modelDownload')}
            </Button>
          )}
        </div>
      </div>
      {busy && (
        <div className="flex items-center gap-3">
          <Progress value={pct} className="flex-1" />
          <span className="text-muted-foreground min-w-14 text-right text-xs tabular-nums">
            {fmtBytes(bytesDone)} / {fmtBytes(model.bytesTotal)}
          </span>
        </div>
      )}
    </div>
  );
}

export function AiFeatures() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);

  useEffect(() => {
    Promise.resolve(getAiConfig())
      .then((c) => setEnabled(!!(c && c.enabled)))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const refreshModels = useCallback(() => {
    Promise.resolve(getModelList())
      .then((list) => setModels(list || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (enabled) refreshModels();
  }, [enabled, refreshModels]);

  useEffect(() => {
    wireIpcOnce();
    const onProg = (p: ModelDownloadProgress) => {
      if (!p) return;
      setProgress(p);
      if (p.file === null) refreshModels(); // final event of a download — status is now on disk
    };
    progressSubs.add(onProg);
    return () => {
      progressSubs.delete(onProg);
    };
  }, [refreshModels]);

  const onToggle = (checked: boolean) => {
    setEnabled(checked);
    Promise.resolve(setAiConfig({ enabled: checked })).catch(() => {
      setEnabled(!checked); // roundtrip failed — the switch must reflect what's actually saved
    });
  };

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    setProgress(null);
    try {
      await downloadModel(id);
    } catch (err) {
      notify(t('modelDownloadFailed', [(err as Error)?.message || '']));
    } finally {
      setDownloadingId(null);
      refreshModels();
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteModel(id);
    } finally {
      refreshModels();
    }
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

      {/* Model list (#832): what's actually downloaded, its license, and the
          get/delete controls — hidden while AI features are off, same as
          every AI-backed feature's own UI (aiEnableHint's promise). */}
      {enabled && models.length > 0 && (
        <Card>
          <CardContent className="space-y-3 text-sm">
            {models.map((m) => (
              <ModelRow key={m.id} model={m} progress={downloadingId === m.id ? progress : null} busy={downloadingId === m.id} onDownload={() => void handleDownload(m.id)} onDelete={() => void handleDelete(m.id)} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
