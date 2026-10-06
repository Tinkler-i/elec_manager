"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Calendar } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/layout/empty-state";
import { SkeletonBar } from "@/components/layout/skeleton-bar";
import { dailyUsage, type DailyUsagePoint } from "@/lib/chart-data";
import { fmtKwh, fmtMoney, monthsAgo, monthsBefore, today } from "@/lib/format";
import type { Reading } from "@/types";

const QUICK_RANGES = [
  { label: "近1月", months: 1 },
  { label: "近3月", months: 3 },
  { label: "近6月", months: 6 },
  { label: "近1年", months: 12 },
];

/**
 * 分析页「日均用电量」。
 *
 * 跨多天的读数按日均折算，悬浮时给出区间合计与电费 —— 只看日均会以为"那天用了
 * 0.8 度"，其实是两周抄一次表摊下来的。这条口径来自原来的 chart.js 实现，未改。
 */
export function DailyUsageChart({
  readings,
  rate,
  loading = false,
}: {
  readings: Reading[];
  rate: number;
  loading?: boolean;
}) {
  // 用户显式选过的区间；null = 还没动过，用下面按数据算出来的默认区间
  const [picked, setPicked] = useState<{ start: string; end: string } | null>(null);

  /**
   * 默认区间的锚点。
   *
   * 不能直接写"今天往前 3 个月"：抄表是低频操作，最后一次读数很可能在两三个月
   * 前（本机数据就是 6 月 13 日）。那样一进页面就是一张空图，看起来像坏了。
   * 所以锚点取「最后一次读数」与「今天」中更靠后的那个 —— 有近期数据时是今天，
   * 数据都过去了就跟着数据走。
   */
  const fallback = useMemo(() => {
    const latest = readings.reduce((max, r) => (r.reading_date > max ? r.reading_date : max), "");
    const anchor = latest && latest < monthsAgo(3) ? latest : today();
    return { start: monthsBefore(anchor, 3), end: anchor };
  }, [readings]);

  const { start: startDate, end: endDate } = picked ?? fallback;

  const points = useMemo(() => {
    const inRange = readings
      .filter((r) => r.reading_date >= startDate && r.reading_date <= endDate)
      .sort((a, b) => a.reading_date.localeCompare(b.reading_date));
    return dailyUsage(inRange, rate);
  }, [readings, startDate, endDate, rate]);

  function applyQuickRange(months: number) {
    setPicked({ start: monthsAgo(months), end: today() });
  }

  function jumpToLatest() {
    setPicked(fallback);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle>日均用电量</CardTitle>
            <p className="text-xs text-muted-foreground">
              跨多天的读数按日均计算，悬浮查看区间合计与电费
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {QUICK_RANGES.map((q) => (
              <Button key={q.months} variant="outline" size="sm" onClick={() => applyQuickRange(q.months)}>
                {q.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="size-4 text-muted-foreground" />
          <Input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setPicked({ start: e.target.value, end: endDate })}
            className="w-[150px]"
            aria-label="开始日期"
          />
          <span className="text-xs text-muted-foreground">至</span>
          <Input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setPicked({ start: startDate, end: e.target.value })}
            className="w-[150px]"
            aria-label="结束日期"
          />
        </div>

        {loading ? (
          <SkeletonBar className="h-[360px] w-full" />
        ) : points.length === 0 ? (
          <EmptyState
            title="该时间段内暂无读数数据"
            description={
              readings.length > 0
                ? `现有 ${readings.length} 条读数都在这个区间之外，最早 ${readings[readings.length - 1]?.reading_date ?? ""}、最晚 ${readings[0]?.reading_date ?? ""}。`
                : "先去「读数记录」补录，分析图就有数据了。"
            }
            action={
              readings.length > 0 ? (
                <Button variant="outline" size="sm" onClick={jumpToLatest}>
                  跳到最近数据
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="daily-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
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
                  content={<DailyTooltip />}
                />
                <Area
                  type="monotone"
                  dataKey="dailyAvg"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  fill="url(#daily-fill)"
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 悬浮内容：单日读数显示「用电 + 电费」，跨多天显示「日均 + N 天合计」。
 *
 * 两种文案必须分开 —— 把跨天区间的合计标成"用电"，用户会以为那是当天用量。
 */
function DailyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: DailyUsagePoint }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;

  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{p.date}</div>
      <div className="mt-0.5 text-muted-foreground">
        日均 {fmtKwh(p.dailyAvg)} 度 · {fmtMoney(p.cost)}
      </div>
      {p.days > 1 ? (
        <div className="text-muted-foreground">
          {p.days} 天合计 {fmtKwh(p.totalConsumed)} 度
        </div>
      ) : null}
    </div>
  );
}
