import type { MessageKey } from '../services/translation.ts';
// #86: タグの行のメニューの「別名を追加…」の操作＝自由入力の別名を登録する
// （danbooru や Hydrus 式。その語が今どれかに付いている必要は無い＝設計の
// 「適用ゼロの語も登録できる」）。登録した別名は、以後の書き込みのたびにこのタグへ解決
// される（lib-db-write.ts の tagResolver と lib-db-record-writer.ts の makeTagResolver）。
// エラーコードは lib-db-tag-vocab.ts の addTagAlias からそのまま来る＝それぞれの意味は
// ipc-payloads.ts の AddTagAliasResult を参照。
import { useState } from 'react';
import { t } from '../_shared/i18n.ts';
import { hologramIpc } from '../services/ipc.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const ERROR_KEY: Record<string, MessageKey> = {
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
          <DialogTitle>{t('tagMgmtAliasDialogTitle', { name: tagName })}</DialogTitle>
          <DialogDescription>{t('tagMgmtAliasDialogDesc', { name: tagName })}</DialogDescription>
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
