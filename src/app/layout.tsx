import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { NavigationDock } from "@/components/navigation-dock";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/auth-provider";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * 字体自托管，不用 next/font/google。
 *
 * next/font/google 在**构建期**要去 fonts.googleapis.com 取 CSS、去
 * fonts.gstatic.com 取 woff2（实现在 @next/font/dist/google/fetch-resource.js，
 * 走 node:https.request）。网络一抖，`npm run build` 就以 module-not-found 失败，
 * 而本地/国内网络和 fnos/build.sh 打包都会偶发撞上 —— 构建不该依赖第三方 CDN 的
 * 可达性。
 *
 * 这两个 woff2 来自官方 geist 包（见同目录 LICENSE.txt，SIL OFL 1.1，可随仓库分发）。
 * 可变字体不需要声明 weight，覆盖 100–900。
 */
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "电表数据管理系统",
  description: "记录电表数据并图形化展示",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning：next-themes 在客户端给 <html> 加 class，
    // 与服务端渲染结果必然不一致，不加这一条 React 会报水合警告。
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider>
          <AuthProvider>
            <NavigationDock />
            {/*
              pb-28：底栏是浮动的，不给底部留白的话最后一行内容会被它压住。
              max-w-7xl 与居中交给这里，页面内只管自己的排版。
            */}
            <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-8 pb-28 sm:px-6 lg:px-8">
              {children}
            </main>
          </AuthProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
