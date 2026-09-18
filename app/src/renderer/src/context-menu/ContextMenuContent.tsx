import type { ComponentProps } from 'react';
import { DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      {...props}
      className={cn('text-[color:var(--text-muted-strong)] [--ui-accent-foreground:var(--text-muted-strong)] w-auto min-w-48 rounded-xl p-1.5 [&_[role^=menuitem]]:min-h-8 [&_[role^=menuitem]]:gap-2 [&_[role^=menuitem]]:rounded-md [&_[role^=menuitem]]:px-2 [&_[role^=menuitem]]:py-1.5', className)}
    />
  );
}
