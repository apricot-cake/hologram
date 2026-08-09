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

// 上流からのフォーク（#981）: サイドバーが取る形はちょうど1つ＝ラベル付きのレール。
//
// 上流の Sidebar は展開と畳みの対になっている。`open` の状態、それを保つ cookie、開閉の
// ボタン、Ctrl+B、そしてモバイル用の Sheet。Hologram もそのすべてを持っていた（レンダラーは
// Next.js のサーバーが配信するものではないので、#149 は状態を cookie ではなく config.json へ
// 置いた）。その後 #678 がレールを既定にし、#965 が利用者の育てたどのグループにもレールから
// 開く飛び出しを与えた。その時点で、展開した列にできてレールにできないことは無くなった。
// 一方で形が2つあることは、2本目の描画の経路と、狭いウィンドウからは手の届かない保存された
// 好みと、幅に連動した後退（#259）を代償にしていた。
//
// だから状態は既定が変わっただけではなく、無くなった。`state` は定数の 'collapsed' で、
// 残る違いは #245 の一括の非表示だけ。あれはパネルに2つ目の形を与えるのではなく、丸ごと
// 画面の外へ出す。下のすべては今も `data-collapsible=icon` を手掛かりにしている＝あれが
// レールのスタイルそのものなので、フォークはそれ以外のどの点でも上流に近いままでいる。
// docs/decisions/0027-sidebar-is-a-rail-only.md を参照。
//
// 上流からのフォーク（#678）: 上流のアイコンのレールはアイコンだけの正方形（16px の字形を
// 中央に置くには 48px で足りる）。Hologram のレールはラベル付き＝Material Design 3 の
// 「Navigation rail」（https://m3.material.io/components/navigation-rail/guidelines）。
// 項目はどれもアイコンの下に一語の短いラベルが付く形で、アイコン単独にはしない＝アイコン
// だけのレールは読めない（「設定のアイコンみたいなのは見れば分かるけど、ビューのグリッドや
// 人型のアイコンは伝わりにくいでしょう？」、#678 自身の理由付け）。
// 72px あれば、アイコンの下にラベルを積んだ行が3行目へ折り返さずに収まる。これを実際に使う
// 行のレイアウトは、下の sidebarMenuButtonVariants を参照。今やこれがパネルの唯一の幅なので、
// --sidebar-width（上流の展開時の 16rem）は展開の形と一緒に消えた。offcanvas は代わりに
// この幅の分だけレールを外へ滑らせる。
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

// この文脈は今や定数（#981）＝ここで形が変わることはない。素の定数ではなく文脈のままに
// してあるのは、下のコンポーネントが上流と同じやり方で状態を読むためと、将来2つ目の形が
// （もし正当化されるなら）戻ってくる場所を1か所に保つため。
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

// 上流からのフォーク（#981）: モバイルの枝は無い。上流は `md`（768px）より下でパネルを
// Sheet に差し替えるが、このウィンドウの最小は 720 ＝767 より狭めると、以前はレールが、
// 開く手立ての残っていない Sheet に置き換わっていた。つまりサイドバーが消えた。デスクトップ
// 専用のアプリにモバイルの形は無いし、レールはウィンドウが取りうるどの寸法でも保てるほど
// 狭い。下の入れ物の `md:block` も同じ理由で一緒に消す。720px ではパネルをそのまま隠して
// いたから。
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
  /** 'icon' がレール。'offcanvas' はそれを画面の外へ丸ごと出す（#245 の一括の非表示）。 */
  collapsible?: 'offcanvas' | 'icon';
}) {
  const { state } = useSidebar();

  return (
    <div className="group peer block text-sidebar-foreground" data-state={state} data-collapsible={collapsible} data-variant={variant} data-side={side} data-slot="sidebar">
      {/* デスクトップでサイドバーの隙間を受け持つのがこれ */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          // 上流からのフォーク（#583）: 'transition-[width] duration-200 ease-linear' は
          // 無い。このパネルを畳むのは今や一瞬で、アプリの他のビューの切り替えと同じ
          // （docs/decisions/0017）。上流はこの隙間と下の入れ物を一緒に動かして、畳む動きが
          // 1つの動きとして読めるようにしている。両方を一瞬にするのは、その同じ「1つの
          // 動き」という性質を、時間0で成り立たせたもの。
          // トランジションを退けたことで、ドラッグでの幅変更のフォーク（#30）が必要として
          // いた 'in-data-[resizing]:transition-none' の抜け道も要らなくなった＝何も動いて
          // いなければドラッグがポインタに遅れることはないので、切るべきものが残っていない。
          // #981: レールの幅がそのままパネルの幅なので、隙間が確保するのも offcanvas が
          // 外へ滑らせる分も --sidebar-width-icon になる。上流の --sidebar-width（展開した
          // 列）は、ここではもう何の意味も持たない。
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
          // 'transition-[left,right,width] duration-200 ease-linear' は無い（#583）＝上の隙間を参照。
          'fixed inset-y-0 z-10 flex h-svh w-(--sidebar-width-icon) data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width-icon)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width-icon)*-1)]',
          // floating と inset の見た目に合わせて余白を調整する。
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

// 上流から取り除いたもの（#981）: SidebarTrigger と SidebarRail。
//
// トリガーはサイドバーのヘッダーにあった畳みのボタン（#628 が列の 32px の軸に合わせ、
// #678 がレールの幅まで広げた）。レールは上流の端にあった切り替えで、#30 でパネルを
// ドラッグして幅を変える仕切りへフォークしたもの。形が1つ・幅が1つになった今、どちらにも
// することが無い＝反転させる状態も、引っ張る幅も無い。詳細パネルは自分の仕切りを持ち続ける
// （shell/InspectorRail.tsx）。あれはもともと別の部品だった。

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

// 上流からのフォーク（#583）: `transition-[margin,opacity] duration-200 ease-linear` は
// 無い。ラベルが上へ滑りながら消える動きは畳みの一部で、その畳みは今や一瞬＝残しておくと、
// 動き終えたパネルの中に 200ms の遅れ者が1つ居残ることになる。
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

// #678 のフォーク点: 以前のアイコンのモードは、切り詰めた 32px のアイコンだけの正方形
// （group-data-[collapsible=icon]:size-8!）だった。今はそれがラベル付きのレールの行になって
// いる＝アイコンの下にラベルを積み、レールの幅（上の SIDEBAR_WIDTH_ICON）を埋める列。
// レールのモードで見せて折り返すべきラベルの span は、「DOM の最後の子である span」として
// 拾うのではなく、`data-slot="menu-label"` で明示的に印を付けなければならない
// （LeftSidebar.tsx を参照）＝以前の `[&>span:last-child]:truncate` のセレクタは、ラベルの
// 後ろに補助の span が続くボタン（コマンドパレットの「Ctrl+K」）で黙って壊れ、ラベルでは
// なく補助の方が実際に切り詰められていた。
// #583 のフォーク点: `transition-[width,height,padding]` は無い＝行は畳みに合わせて形を
// 変えるが、その畳みは一瞬だから。
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

  // #981: 上流はサイドバーが展開している間ツールチップを隠す（ラベルがすぐそこにあるから）。
  // 展開した状態はもう残っていないので、ツールチップは単に常に使える＝レール自身のラベルは
  // 切り詰められた一語で、ツールチップが完全な名前になる。
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
  // 50〜90% の間で無作為な幅。
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
