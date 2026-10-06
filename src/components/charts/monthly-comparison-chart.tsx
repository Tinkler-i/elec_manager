"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { monthlyConsumption } from "@/lib/chart-data";
import { fmtKwh, fmtMoney } from "@/lib/format";
import type { Reading } from "@/types";

/**
 * 「月度用电对比」：最近 6 个月各用了多少度。
 *
 * 原来 chart.js 版本挂了一条 y1 轴标着「电费(元)」，但没有任何数据集映射到它 ——
 * 也就是说右侧那排数字与图上的柱子毫无关系。recharts 版本去掉了它，电费改在
 * 悬浮里给出（这本来就是唯一能用到它的地方）。
 */
export function MonthlyComparisonChart({ readings, rate }: { readings: Reading[]; rate: number }) {
  const data = monthlyConsumption(readings, 6);
  if (data.length === 0) return null;

  const max = Math.max(...data.map((d) => d.consumed), 0);

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
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
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
              color: "var(--popover-foreground)",
            }}
            labelStyle={{ color: "var(--muted-foreground)" }}
            formatter={(value: number) => [`${fmtKwh(value)} 度 · ${fmtMoney(value * rate)}`, "用电量"]}
          />
          <Bar dataKey="consumed" radius={[6, 6, 0, 0]}>
            {/* 用电最高的那个月用主色标出来，一眼能看出峰值在哪 */}
            {data.map((d) => (
              <Cell
                key={d.month}
                fill={d.consumed === max && max > 0 ? "var(--chart-1)" : "var(--chart-3)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
