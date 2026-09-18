import { useId, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { t } from '../_shared/i18n.ts';
import { hologramIpc } from '../services/ipc.ts';
import { setTagGroup } from '../services/tags.ts';
import { normalizeTagName } from '../../../../../native-host/tag-normalize.mts';
import type { TagPickGroup } from './TagField.tsx';

export function CreateTagDialog({ groups, onAdd, onClose }: { groups: TagPickGroup[]; onAdd: (name: string) => void | Promise<void>; onClose: () => void }) {
  const nameId = useId();
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tagCreate')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !normalizeTagName(name)) return;
            setBusy(true);
            setError(false);
            try {
              const normalized = normalizeTagName(name);
              await onAdd(normalized);
              if (group) {
                const matches = (await hologramIpc.getTagVocab()).filter((row) => row.name === normalized);
                if (matches.length !== 1) throw new Error('Ambiguous tag');
                await setTagGroup(matches[0].id, group);
              }
              onClose();
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
          className="flex flex-col gap-4"
        >
          <label htmlFor={nameId} className="flex flex-col gap-2">
            {t('tagName')}
            <Input id={nameId} autoFocus value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          <label className="flex flex-col gap-2">
            {t('tagGroupHeader')}
            <select className="rounded-md border bg-background p-2" value={group} onChange={(e) => setGroup(e.target.value)} disabled={busy}>
              <option value="">{t('tagUncategorized')}</option>
              {groups
                .filter((g) => g.id)
                .map((g) => (
                  <option key={g.id} value={g.id || ''}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {t('tagMgmtErrorGeneric')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('tagMgmtCancel')}
            </Button>
            <Button type="submit" disabled={busy || !normalizeTagName(name)}>
              {t('tagCreateApply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
