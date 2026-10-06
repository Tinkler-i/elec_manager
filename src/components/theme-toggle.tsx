"use client";

import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

const ORDER = ["system", "light", "dark"] as const;
type Mode = (typeof ORDER)[number];

const META: Record<Mode, { label: string; Icon: typeof Sun }> = {
  system: { label: "跟随系统", Icon: Monitor },
  light: { label: "亮色", Icon: Sun },
  dark: { label: "暗色", Icon: Moon },
};

/**
 * 主题切换：点击在 跟随系统 → 亮色 → 暗色 之间循环。
 *
 * 用循环而不是下拉菜单：只有三个值，下拉要多两次点击、还要多一个浮层组件。
 *
 * 不需要 `mounted` 标志位来避免水合不一致：next-themes 在首次渲染时
 * `theme` 就是 undefined，服务端与客户端首帧都落到 "system"，两边渲染一致；
 * 挂载后它才读 localStorage 并触发重渲染。
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  const current: Mode = ORDER.includes(theme as Mode) ? (theme as Mode) : "system";
  const { label, Icon } = META[current];

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      title={`主题：${label}（点击切换）`}
      aria-label={`主题：${label}（点击切换）`}
      onClick={() => {
        const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
        setTheme(next);
      }}
    >
      <Icon />
    </Button>
  );
}
