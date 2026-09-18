import { hologramIpc } from './ipc.ts';
import { setTagGroup, setTagGroupLabel } from './tags.ts';
import { t } from '../_shared/i18n.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { open as openConfirm } from './confirm.ts';
import { open as openMenu } from './menu.ts';
import { notify } from './ui.ts';

export async function moveTag(id: number, groupId: string | null) {
  try {
    await setTagGroup(id, groupId);
  } catch {
    notify(t('tagMgmtErrorGeneric'));
  }
}

export function createTagGroup(onCreated?: (id: string) => void | Promise<void>) {
  promptName(t('tagGroupCreate'), '', async (name) => {
    try {
      const state = await hologramIpc.getTagGroups();
      if (Object.values(state.labels || {}).includes(name)) {
        notify(t('tagGroupNameExists'));
        return;
      }
      const id = crypto.randomUUID();
      await setTagGroupLabel(id, name);
      await onCreated?.(id);
    } catch {
      notify(t('tagMgmtErrorGeneric'));
    }
  });
}

export function showGroupActions(groupId: string, name: string, x: number, y: number) {
  openMenu(
    {
      x,
      y,
      items: [
        { label: t('tagGroupRename'), act: 'rename', iconName: 'pencil' },
        { label: t('tagGroupDelete'), act: 'delete', iconName: 'trash-2', danger: true },
      ],
    },
    (item) => {
      if (item.act === 'rename')
        promptName(t('tagGroupRename'), name, async (next) => {
          try {
            const state = await hologramIpc.getTagGroups();
            if (Object.entries(state.labels || {}).some(([id, label]) => id !== groupId && label === next)) {
              notify(t('tagGroupNameExists'));
              return;
            }
            await setTagGroupLabel(groupId, next);
          } catch {
            notify(t('tagMgmtErrorGeneric'));
          }
        });
      if (item.act === 'delete')
        openConfirm({
          message: t('tagGroupDeleteConfirm', { name }),
          okLabel: t('tagMgmtDelete'),
          cancelLabel: t('tagMgmtCancel'),
          onOk: async () => {
            try {
              const state = await hologramIpc.getTagGroups();
              const labels = { ...state.labels };
              delete labels[groupId];
              const result = await hologramIpc.setTagGroups(
                state.memberships.filter((row) => row.groupId !== groupId),
                labels,
              );
              if (!result.ok) throw new Error('Could not delete group');
            } catch {
              notify(t('tagMgmtErrorGeneric'));
            }
          },
        });
    },
  );
}
