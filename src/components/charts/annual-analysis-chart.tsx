"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { annualChartRows, annualSeries } from "@/lib/chart-data";
import { fmtKwh, fmtMoney } from "@/lib/format";
import type { Reading } from "@/types";

/** 年份线色：与设计令牌的 5 个图表色对齐，超过 5 年后循环使用 */
const YEAR_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/**
 * 「年度深度分析」：按年对比逐月用电量。
 *
 * 某年某月没抄表时该点为 null，`connectNulls` 保持默认的 false —— 曲线会断开，
 * 与「这个月真的用了 0 度」区分开。这是原实现里 chart.js 用 null 表达的同一件事。
 */
export function AnnualAnalysisChart({ readings, rate }: { readings: Reading[]; rate: number }) {
  const series = annualSeries(readings);
  if (series.years.length === 0) return null;

  const rows = annualChartRows(series);

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
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
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
              color: "var(--popover-foreground)",
            }}
            labelStyle={{ color: "var(--muted-foreground)" }}
            formatter={(value: number, name: string) => [
              `${fmtKwh(value)} 度 · ${fmtMoney(value * rate)}`,
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
          {series.years.map((y, i) => (
            <Line
              key={y.year}
              type="monotone"
              dataKey={y.year}
              name={y.year}
              stroke={YEAR_COLORS[i % YEAR_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
