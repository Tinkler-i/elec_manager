"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { authApi } from "@/lib/api";
import { NAV_ITEMS, isActivePath, type NavItem } from "@/lib/nav";
import { useUpdateCheck } from "@/lib/use-update-check";
import { cn } from "@/lib/utils";

/**
 * 浮动底栏导航。
 *
 * 形态参照 workbuddy-manager（MIT）的 FloatingDock：固定在底部居中，图标悬浮，
 * 标签只在 hover 时从图标上方浮出。相比原来的顶部横排：
 *
 *  · 内容区不再被一条 64px 的横条切掉，长表格能多用一屏；
 *  · 导航与内容在视觉上分层（底栏浮在内容之上），滚动时位置不变；
 *  · 条目是图标 + 悬浮标签，窄屏不用把文字挤成一排。
 *
 * 与 workbuddy 的差别：没有做拖拽与「固定/浮动」双模式。那套交互需要额外
 * 维护坐标持久化与长按判定，对 5 个固定条目收益不大 —— 位置永远在底部居中，
 * 反而更好预测。
 */
export function NavigationDock() {
  const pathname = usePathname();

  // 登录页不显示导航（原来 Navigation 也是这个行为）。
  //
  // 判断放在这一层，让下面的 Dock 整个不挂载。写在下层只做 early return 是不够的：
  // hook 在 return 之前就跑了，登录页照样会发一次 /api/update，而未登录必然 401。
  if (pathname === "/login") return null;

  return <Dock pathname={pathname} />;
}

function Dock({ pathname }: { pathname: string }) {
  const router = useRouter();
  // 有新版本时在「设置」图标上点一个小圆点 —— 提醒得让人看得见，
  // 藏进设置页的 Tab 里等于没提醒
  const update = useUpdateCheck();

  async function handleLogout() {
    try {
      await authApi.logout();
    } catch {
      /* 登出接口失败也要放行到登录页，否则用户被困在一个已失效的会话里 */
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <nav
      aria-label="主导航"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-border/60 bg-background/80 p-1.5 shadow-lg backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
        {NAV_ITEMS.map((item) => (
          <DockItem
            key={item.href}
            item={item}
            active={isActivePath(pathname, item.href)}
            badge={item.href === "/settings" && (update?.hasUpdate ?? false)}
          />
        ))}

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ThemeToggle />
        <Button variant="ghost" size="icon" onClick={handleLogout} title="退出登录" aria-label="退出登录">
          <LogOut />
        </Button>
      </div>
    </nav>
  );
}

function DockItem({ item, active, badge = false }: { item: NavItem; active: boolean; badge?: boolean }) {
  const { href, label, icon: Icon } = item;

  return (
    <Link
      href={href}
      aria-label={badge ? `${label}（有新版本）` : label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative grid size-10 place-items-center rounded-xl transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-[18px]" />
      {badge ? (
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 size-2 rounded-full bg-blue-500 ring-2 ring-background"
        />
      ) : null}
      {/* 悬浮标签：纯 CSS，不引第三方 tooltip 组件 */}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 scale-95 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background opacity-0 transition duration-150 group-hover:scale-100 group-hover:opacity-100"
      >
        {label}
      </span>
    </Link>
  );
}
