"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

const navItems = [
  { href: "/", label: "仪表盘" },
  { href: "/readings", label: "读数记录" },
  { href: "/analytics", label: "数据分析" },
  { href: "/mcp", label: "MCP工具" },
  { href: "/settings", label: "设置" },
];

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return null;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-xl font-bold text-gray-900">
            电表管理系统
          </Link>
          <nav className="flex items-center space-x-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  pathname === item.href
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                )}
              >
                {item.label}
              </Link>
            ))}
            <Button variant="ghost" size="icon" onClick={handleLogout} title="退出登录">
              <LogOut className="w-4 h-4" />
            </Button>
          </nav>
        </div>
      </div>
    </header>
  );
}
