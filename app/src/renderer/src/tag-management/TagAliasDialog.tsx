// #86: the tag row menu's "別名を追加…" action — registers a free-text alias
// (danbooru/Hydrus-style; no requirement that the text currently applies to
// anything, per the design's "適用ゼロの語も登録できる") that resolves to this
// tag on every future write (lib-db-write.ts's tagResolver / lib-db-record-
// writer.ts's makeTagResolver). Error codes come straight from
// lib-db-tag-vocab.ts's addTagAlias — see ipc-payloads.ts's AddTagAliasResult
// for what each one means.
import { useState } from 'react';
import { t } from '../_shared/i18n.ts';
import { hologramIpc } from '../services/ipc.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const ERROR_KEY: Record<string, string> = {
  self: 'tagMgmtAliasErrorSelf',
  'name-collision': 'tagMgmtAliasErrorNameCollision',
  conflict: 'tagMgmtAliasErrorConflict',
};

export function TagAliasDialog({ tagId, tagName, onClose, onDone }: { tagId: number; tagName: string; onClose: () => void; onDone: () => void }) {
  const [alias, setAlias] = useState('');
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    const value = alias.trim();
    if (!value) return;
    const res = await hologramIpc.addTagAlias(tagId, value);
    if (!res.ok) {
      setError(ERROR_KEY[res.error] ? t(ERROR_KEY[res.error]) : t('tagMgmtErrorGeneric'));
      return;
    }
    onDone();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tagMgmtAliasDialogTitle', [tagName])}</DialogTitle>
          <DialogDescription>{t('tagMgmtAliasDialogDesc', [tagName])}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          <Input
            autoFocus
            value={alias}
            placeholder={t('tagMgmtAliasPh')}
            onChange={(e) => {
              setAlias(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm();
            }}
          />
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('tagMgmtCancel')}
          </Button>
          <Button disabled={!alias.trim()} onClick={confirm}>
            {t('tagMgmtAliasAdd')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
