import { Cursor } from '@dnd-kit/dom';
import { DragDropProvider, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { moveTag } from '../services/tag-group-actions';

export function TagDragProvider({ children, onMoved }: { children: ReactNode; onMoved?: () => void | Promise<void> }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  return (
    <DragDropProvider
      plugins={(defaults) => defaults.map((plugin) => (plugin === Cursor ? { plugin: Cursor, options: { cursor: 'default' } } : plugin))}
      onBeforeDragStart={(event) => {
        const { source, activatorEvent } = event.operation;
        const rect = source?.element?.getBoundingClientRect();
        if (rect && activatorEvent instanceof PointerEvent) {
          setOffset({ x: activatorEvent.clientX - rect.left, y: activatorEvent.clientY - rect.top });
        } else {
          setOffset({ x: 0, y: 0 });
        }
      }}
      onDragEnd={async (event) => {
        if (event.canceled) return;
        const { source, target } = event.operation;
        if (!source || !target || target.data.groupId === undefined) return;
        await moveTag(source.data.tagId as number, target.data.groupId as string | null);
        await onMoved?.();
      }}
    >
      {children}
      <DragOverlay dropAnimation={null} style={{ zIndex: 14000 }}>
        {(source) => (
          <Badge variant="outline" className="pointer-events-none absolute h-auto max-w-64 -translate-y-1/2 rounded-md border-border/40 bg-popover px-3 py-2 text-sm font-normal text-[color:var(--text-muted-strong)] shadow-md" style={{ left: offset.x + 16, top: offset.y }} data-slot="tag-drag-preview">
            <span className="truncate">{String(source.data.name)}</span>
          </Badge>
        )}
      </DragOverlay>
    </DragDropProvider>
  );
}

type DragProps = { tagId: number | undefined; tagName: string };
export function TagDragLabel({ tagId, tagName, ...props }: DragProps & ComponentProps<'label'>) {
  const id = useId();
  const { ref } = useDraggable({ id, disabled: tagId == null, data: { tagId, name: tagName } });
  // biome-ignore lint/a11y/noLabelWithoutControl: 呼び出し側がチェックボックスと名前を children に渡す。
  return <label {...props} role="group" ref={ref} data-tag-draggable={tagId != null} />;
}
type DropProps = { groupId: string | null | undefined };
export function TagDropDetails({ groupId, className = '', ...props }: DropProps & ComponentProps<'details'>) {
  const id = useId();
  const { ref, isDropTarget } = useDroppable({ id, disabled: groupId === undefined, data: { groupId } });
  return <details {...props} ref={ref} data-drop-target={isDropTarget || undefined} className={className + ' data-[drop-target=true]:inset-ring-2 data-[drop-target=true]:inset-ring-ring'} />;
}
