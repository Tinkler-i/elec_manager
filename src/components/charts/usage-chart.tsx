"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { monthlyDailyAverage } from "@/lib/chart-data";
import { fmtKwh } from "@/lib/format";
import type { Reading } from "@/types";

/** recharts 浮层样式：用 CSS 变量，暗色下自动跟着变（默认样式是写死的白底） */
const TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  fontSize: 12,
  color: "var(--popover-foreground)",
} as const;

/**
 * 仪表盘「用电趋势」：最近 6 个月的日均用电量。
 *
 * 取数由页面负责，这里只负责画 —— 原来这张图和另外三张图各自 fetch 一遍
 * `/api/readings`，首页打开一次要拉五份相同的数据。
 */
export function UsageChart({ readings }: { readings: Reading[] }) {
  const data = monthlyDailyAverage(readings, 6);
  if (data.length === 0) return null;

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="usage-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "var(--muted-foreground)" }}
            formatter={(value: number) => [`${fmtKwh(value)} 度/天`, "日均用电"]}
          />
          <Area
            type="monotone"
            dataKey="dailyAvg"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#usage-fill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
