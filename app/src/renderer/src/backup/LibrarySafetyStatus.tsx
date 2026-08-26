import { useEffect, useReducer, useRef, useState } from 'react';
import { ArchiveRestore, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { t } from '../_shared/i18n.ts';
import { getExportReminder, getIntegrityStatus, onExportReminderChanged, onIntegrityCheckDone } from '../services/backup.ts';
import { createBackupFile } from '../services/backup-file.ts';
import { open as openSettings, isOpen as settingsIsOpen, subscribe as settingsSubscribe } from '../services/settings.ts';

export function LibrarySafetyStatus() {
  const reminderRef = useRef<any>(null);
  const integrityRef = useRef<any>(null);
  const [open, setOpen] = useState(false);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        reminderRef.current = await getExportReminder();
      } catch {
        reminderRef.current = null;
      }
      try {
        integrityRef.current = await getIntegrityStatus();
      } catch {
        integrityRef.current = null;
      }
      if (alive) tick();
    };
    void load();
    onExportReminderChanged((state: any) => {
      reminderRef.current = state;
      if (alive) tick();
    });
    onIntegrityCheckDone((state: any) => {
      integrityRef.current = state;
      if (alive) tick();
    });
    let settingsWasOpen = settingsIsOpen();
    const unsubscribe = settingsSubscribe(() => {
      const nowOpen = settingsIsOpen();
      if (settingsWasOpen && !nowOpen) void load();
      settingsWasOpen = nowOpen;
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const integrity = integrityRef.current;
  if (integrity?.dbOk === false || integrity?.orphanCount > 0) {
    const label = integrity.dbOk === false ? t('integrityDbBad') : t('integrityOrphanTip', [integrity.orphanCount]);
    return (
      <SidebarMenuItem>
        <SidebarMenuButton tooltip={label} aria-label={label} className="text-destructive">
          <TriangleAlert />
          <span data-slot="menu-label">{label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  const reminder = reminderRef.current;
  if (!reminder?.due) return null;
  const label = t('exportReminderTitle');
  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <SidebarMenuButton tooltip={label} aria-label={label} className="text-amber-600 dark:text-amber-400">
              <ArchiveRestore />
              <span data-slot="menu-label">{label}</span>
            </SidebarMenuButton>
          }
        />
        <PopoverContent side="right" align="end" sideOffset={8} className="w-80 gap-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">{label}</div>
            <p className="text-muted-foreground text-sm">{t('exportReminderStatus', [reminder.changesSinceExport])}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                void createBackupFile();
              }}
            >
              {t('backupFileCreate')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOpen(false);
                openSettings('data');
              }}
            >
              {t('exportReminderOpenSettings')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
