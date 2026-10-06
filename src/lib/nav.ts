import {
  ChartLine,
  Gauge,
  LayoutDashboard,
  Plug,
  Settings,
  type LucideIcon,
} from "lucide-react";

/** 主导航条目。顺序即底栏从左到右的顺序。 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/readings", label: "读数记录", icon: Gauge },
  { href: "/analytics", label: "数据分析", icon: ChartLine },
  { href: "/mcp", label: "MCP 服务", icon: Plug },
  { href: "/settings", label: "设置", icon: Settings },
];

/**
 * 当前路径是否属于某个导航条目。
 *
 * `/` 必须精确匹配，否则所有路径都是它的子路径，仪表盘会永远高亮。
 * 其余用「相等或子路径」，这样以后加 `/readings/xxx` 详情页时高亮仍然正确。
 */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
