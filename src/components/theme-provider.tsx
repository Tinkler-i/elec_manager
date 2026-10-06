"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * 深色模式。
 *
 * 项目里本来就装了 next-themes，但一直没接 —— 根 layout 是写死的
 * `bg-gray-50`，globals.css 里的 `.dark` 变量块因此从来没生效过。
 *
 * `attribute="class"` 与 globals.css 的 `@custom-variant dark (&:is(.dark *))` 配套；
 * `disableTransitionOnChange` 避免切换主题时整页元素一起做颜色过渡（会闪）。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
