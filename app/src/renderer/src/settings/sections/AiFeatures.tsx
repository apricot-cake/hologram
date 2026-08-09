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

// AI 機能を使うと自分で選ぶためのゲート（#830、親は #98）。既定は切。下のスイッチを入れる
// までは、AI を使う機能（タグ付け・OCR・画像検索＝#50/#49/#51）は一切走らず、それらの UI も
// このページの外のどこにも現れない。開示の文言は #98 の透明性の原則が求める器そのもので、
// 下のモデル一覧（#832）はその器が空けておいたモデルごとの詳細＝各モデルのライセンスが何か、
// そして透明性の原則が言う「利用者が完全に元へ戻せる」が指している取得と削除の操作。

function fmtBytes(n: number): string {
  if (!n) return '0 MB';
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// preload の onModelDownloadProgress のブリッジは、呼ばれるたびに新しい ipcRenderer の
// listener を外す手立て無しで付ける。そしてこのコンポーネントは設定を開くたびに載せ直される。
// だから下地の IPC の listener はちょうど1回だけ繋ぎ、そこから生きている React の購読者の
// 集合へ配る（Data.tsx の wireIpcOnce が save-folder-progress や backup-done に使っている
// のと同じ型）。
const progressSubs = new Set<(p: ModelDownloadProgress) => void>();
let ipcWired = false;
function wireIpcOnce() {
  if (ipcWired) return;
  ipcWired = true;
  try {
    onModelDownloadProgress((p) => progressSubs.forEach((cb) => cb(p)));
  } catch {
    /* 素の dev サーバー: hologramIpc の裏に preload のブリッジが無い */
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
      if (p.file === null) refreshModels(); // ダウンロードの最後のイベント＝状態はもうディスク上にある
    };
    progressSubs.add(onProg);
    return () => {
      progressSubs.delete(onProg);
    };
  }, [refreshModels]);

  const onToggle = (checked: boolean) => {
    setEnabled(checked);
    Promise.resolve(setAiConfig({ enabled: checked })).catch(() => {
      setEnabled(!checked); // 往復に失敗した＝スイッチは実際に保存されている内容を映さなければならない
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

      {/* モデル一覧（#832）: 実際にダウンロードされているもの、そのライセンス、取得と
          削除の操作。AI 機能が切の間は隠す＝AI を使う機能それぞれの UI と同じ扱い
          （aiEnableHint での約束）。 */}
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
