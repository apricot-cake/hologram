'use client';

import * as React from 'react';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// FORKED FROM UPSTREAM (#981): the sidebar has exactly ONE form — the labeled rail.
//
// Upstream's Sidebar is an expand/collapse pair: `open` state, a cookie to persist it, a
// trigger, Ctrl+B, and a mobile Sheet. Hologram had all of that (#149 put the state in
// config.json instead of the cookie, since the renderer is not served by a Next.js
// server), then #678 made the rail the DEFAULT and #965 gave the rail a flyout for every
// user-grown group. At that point the expanded column could do nothing the rail cannot,
// while the pair of forms cost a second render path, a saved preference the user could
// not reach from a narrow window, and a width-linked retreat (#259).
//
// So the state is gone, not merely defaulted: `state` is the constant 'collapsed' and the
// only variation left is #245's bulk hide, which takes the whole panel off screen rather
// than giving it a second shape. Everything below still keys off `data-collapsible=icon`
// — that IS the rail's styling — so the fork stays close to upstream in every other way.
// See docs/decisions/0027-sidebar-is-a-rail-only.md.
//
// FORKED FROM UPSTREAM (#678): upstream's icon rail is an icon-only square (48px is
// enough to center a 16px glyph). Hologram's rail is a LABELED one —
// Material Design 3's "Navigation rail" (https://m3.material.io/components/navigation-rail/guidelines):
// each item is an icon over a short 1-word label, never an icon alone — an icon-only rail
// doesn't read ("Something like the settings icon you can tell just by looking at it, but
// the grid or person-mark icons for the views are hard to get across, right?", #678's own
// reasoning).
// 72px is room enough for a stacked icon-over-label row without wrapping onto a third
// line. See sidebarMenuButtonVariants below for the row layout that actually uses this.
// It is now the panel's ONLY width, so --sidebar-width (upstream's expanded 16rem) is
// gone with the expanded form; offcanvas slides the rail out by this width instead.
const SIDEBAR_WIDTH_ICON = '4.5rem';

type SidebarContextProps = {
  state: 'collapsed';
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }

  return context;
}

// The context is a constant now (#981) — nothing here can change shape. It stays a
// context rather than a plain constant so the components below read the state the same
// way upstream's do, and so a future second form (if one is ever justified) has one
// place to come back to.
const RAIL_CONTEXT: SidebarContextProps = { state: 'collapsed' };

function SidebarProvider({ className, style, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <SidebarContext.Provider value={RAIL_CONTEXT}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn('group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

// FORKED FROM UPSTREAM (#981): no mobile branch. Upstream swaps the panel for a Sheet
// below `md` (768px), and this window's minimum is 720 — so shrinking it past 767 used to
// replace the rail with a Sheet that has no opener left, i.e. the sidebar disappeared.
// A desktop-only app has no mobile form; the rail is narrow enough to keep at any size
// the window can reach. `md:block` on the container below goes with it, for the same
// reason: at 720px it was hiding the panel outright.
function Sidebar({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'icon',
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right';
  variant?: 'sidebar' | 'floating' | 'inset';
  /** 'icon' is the rail; 'offcanvas' takes it off screen entirely (#245's bulk hide). */
  collapsible?: 'offcanvas' | 'icon';
}) {
  const { state } = useSidebar();

  return (
    <div className="group peer block text-sidebar-foreground" data-state={state} data-collapsible={collapsible} data-variant={variant} data-side={side} data-slot="sidebar">
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          // FORKED FROM UPSTREAM (#583): no 'transition-[width] duration-200 ease-linear'.
          // Collapsing this panel is instant now, like every other view switch in the app
          // (docs/decisions/0017). Upstream animates this gap and the container below
          // together so the collapse reads as one motion; instant on both is that same
          // "one motion" property at zero duration.
          // Retiring the transition also retired the 'in-data-[resizing]:transition-none'
          // escape hatch the drag-resize fork (#30) needed — with nothing animating, a
          // drag cannot trail the pointer, so there is nothing left to switch off.
          // #981: the rail's width IS the panel's width, so --sidebar-width-icon is what
          // the gap reserves and what offcanvas slides out by. Upstream's --sidebar-width
          // (the expanded column) has no meaning here any more.
          'relative bg-transparent',
          'group-data-[collapsible=offcanvas]:w-0',
          'group-data-[side=right]:rotate-180',
          variant === 'floating' || variant === 'inset' ? 'w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]' : 'w-(--sidebar-width-icon)',
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          // No 'transition-[left,right,width] duration-200 ease-linear' (#583) — see the gap above.
          'fixed inset-y-0 z-10 flex h-svh w-(--sidebar-width-icon) data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width-icon)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width-icon)*-1)]',
          // Adjust the padding for floating and inset variants.
          variant === 'floating' || variant === 'inset' ? 'w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)] p-2' : 'group-data-[side=left]:border-r group-data-[side=right]:border-l',
          className,
        )}
        {...props}
      >
        <div data-sidebar="sidebar" data-slot="sidebar-inner" className="flex size-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 group-data-[variant=floating]:ring-sidebar-border">
          {children}
        </div>
      </div>
    </div>
  );
}

// REMOVED FROM UPSTREAM (#981): SidebarTrigger and SidebarRail.
//
// The trigger was the collapse button in the sidebar's header (#628 sized it to the
// column's 32px axis, #678 widened it to the rail); the rail was upstream's edge toggle,
// forked in #30 into the panel's drag-to-resize splitter. With one form and one width
// there is nothing for either to do — no state to flip, no width to drag. The inspector
// keeps its own splitter (shell/InspectorRail.tsx), which was always a separate part.

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn('relative flex w-full flex-1 flex-col bg-background md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2', className)}
      {...props}
    />
  );
}

function SidebarInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return <Input data-slot="sidebar-input" data-sidebar="input" className={cn('h-8 w-full bg-background shadow-none', className)} {...props} />;
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" data-sidebar="header" className={cn('flex flex-col gap-2 p-2', className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" data-sidebar="footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />;
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return <Separator data-slot="sidebar-separator" data-sidebar="separator" className={cn('mx-2 w-auto bg-sidebar-border', className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" data-sidebar="content" className={cn('no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto group-data-[collapsible=icon]:overflow-hidden', className)} {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" data-sidebar="group" className={cn('relative flex w-full min-w-0 flex-col p-2', className)} {...props} />;
}

// FORKED FROM UPSTREAM (#583): no `transition-[margin,opacity] duration-200 ease-linear`.
// The label's slide-up-and-fade is part of the collapse, and the collapse is instant now —
// keeping it would leave one 200ms straggler inside a panel that has finished moving.
function SidebarGroupLabel({ className, render, ...props }: useRender.ComponentProps<'div'> & React.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn('flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0', className),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-group-label',
      sidebar: 'group-label',
    },
  });
}

function SidebarGroupAction({ className, render, ...props }: useRender.ComponentProps<'button'> & React.ComponentProps<'button'>) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(
          'absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-group-action',
      sidebar: 'group-action',
    },
  });
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group-content" data-sidebar="group-content" className={cn('w-full text-sm', className)} {...props} />;
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" data-sidebar="menu" className={cn('flex w-full min-w-0 flex-col gap-0', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" data-sidebar="menu-item" className={cn('group/menu-item relative', className)} {...props} />;
}

// #678 fork point: icon mode used to be a clipped 32px icon-only square
// (group-data-[collapsible=icon]:size-8!); it is now a labeled rail row instead — a
// stacked icon-over-label column that fills the rail's width (SIDEBAR_WIDTH_ICON above).
// The label span that should show/wrap in rail mode has to be marked explicitly with
// `data-slot="menu-label"` (see LeftSidebar.tsx) rather than picked up as "whichever span
// is the DOM's last child" — the old `[&>span:last-child]:truncate` selector broke
// silently for any button with a trailing hint span after the label (command palette's
// "Ctrl+K"), where the hint, not the label, was the one thing actually getting truncated.
// #583 fork point: no `transition-[width,height,padding]` — the row reshapes with the
// collapse, and the collapse is instant.
const sidebarMenuButtonVariants = cva(
  'peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:h-auto! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:px-1! group-data-[collapsible=icon]:py-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 group-data-[collapsible=icon]:[&_svg]:size-5 [&_[data-slot=menu-label]]:truncate group-data-[collapsible=icon]:[&_[data-slot=menu-label]]:w-full group-data-[collapsible=icon]:[&_[data-slot=menu-label]]:overflow-visible group-data-[collapsible=icon]:[&_[data-slot=menu-label]]:whitespace-normal group-data-[collapsible=icon]:[&_[data-slot=menu-label]]:text-center group-data-[collapsible=icon]:[&_[data-slot=menu-label]]:text-[10px] group-data-[collapsible=icon]:[&_[data-slot=menu-label]]:leading-[1.15]',
  {
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        outline: 'bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm group-data-[collapsible=icon]:p-0!',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function SidebarMenuButton({
  render,
  isActive = false,
  variant = 'default',
  size = 'default',
  tooltip,
  className,
  ...props
}: useRender.ComponentProps<'button'> &
  React.ComponentProps<'button'> & {
    isActive?: boolean;
    tooltip?: string | React.ComponentProps<typeof TooltipContent>;
  } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const comp = useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      },
      props,
    ),
    render: !tooltip ? render : <TooltipTrigger render={render} />,
    state: {
      slot: 'sidebar-menu-button',
      sidebar: 'menu-button',
      size,
      active: isActive,
    },
  });

  if (!tooltip) {
    return comp;
  }

  if (typeof tooltip === 'string') {
    tooltip = {
      children: tooltip,
    };
  }

  // #981: upstream hides the tooltip while the sidebar is expanded (the label is right
  // there). There is no expanded state left, so the tooltip is simply always available —
  // the rail's own label is a truncated one word, and the tooltip is the full name.
  return (
    <Tooltip>
      {comp}
      <TooltipContent side="right" align="center" {...tooltip} />
    </Tooltip>
  );
}

function SidebarMenuAction({
  className,
  render,
  showOnHover = false,
  ...props
}: useRender.ComponentProps<'button'> &
  React.ComponentProps<'button'> & {
    showOnHover?: boolean;
  }) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(
          'absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0',
          showOnHover && 'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-menu-action',
      sidebar: 'menu-action',
    },
  });
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        'pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 peer-data-active/menu-button:text-sidebar-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<'div'> & {
  showIcon?: boolean;
}) {
  // Random width between 50 to 90%.
  const [width] = React.useState(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`;
  });

  return (
    <div data-slot="sidebar-menu-skeleton" data-sidebar="menu-skeleton" className={cn('flex h-8 items-center gap-2 rounded-md px-2', className)} {...props}>
      {showIcon && <Skeleton className="size-4 rounded-md" data-sidebar="menu-skeleton-icon" />}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            '--skeleton-width': width,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu-sub" data-sidebar="menu-sub" className={cn('mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden', className)} {...props} />;
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-sub-item" data-sidebar="menu-sub-item" className={cn('group/menu-sub-item relative', className)} {...props} />;
}

function SidebarMenuSubButton({
  render,
  size = 'md',
  isActive = false,
  className,
  ...props
}: useRender.ComponentProps<'a'> &
  React.ComponentProps<'a'> & {
    size?: 'sm' | 'md';
    isActive?: boolean;
  }) {
  return useRender({
    defaultTagName: 'a',
    props: mergeProps<'a'>(
      {
        className: cn(
          'flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-sm data-[size=sm]:text-xs data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'sidebar-menu-sub-button',
      sidebar: 'menu-sub-button',
      size,
      active: isActive,
    },
  });
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  useSidebar,
};
