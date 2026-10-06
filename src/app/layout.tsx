import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavigationDock } from "@/components/navigation-dock";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/auth-provider";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
