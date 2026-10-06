import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 指标卡。
 *
 * 与原来 `Card` + `CardHeader` + `CardContent` 三层嵌套的区别：这里把
 * 「标签 / 数值 / 补充说明」的位置固定下来，四个卡片并排时数字不会因为
 * 标签长短而错位。数值字号也统一 —— 原来每页各写各的 `text-2xl`。
 */

const TONES = {
  default: "text-foreground",
  positive: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  accent: "text-blue-600 dark:text-blue-400",
} as const;

export type StatTone = keyof typeof TONES;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground/70" /> : null}
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded-md bg-muted" />
      ) : (
        <div className={cn("mt-1 text-2xl font-semibold tabular-nums", TONES[tone])}>{value}</div>
      )}
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
