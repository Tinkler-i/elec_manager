"use client";

import { ChartLine, Coins, Gauge, Zap } from "lucide-react";

import { UsageChart } from "@/components/charts/usage-chart";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadError } from "@/components/layout/load-error";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readingsApi, settingsApi, statsApi } from "@/lib/api";
import { fmtKwh, fmtMoney, fmtNumber } from "@/lib/format";
import { useAsyncAll } from "@/lib/use-async-data";
import { useHeartbeat } from "@/lib/use-heartbeat";

const REFRESH_MS = 30_000;

/**
 * 仪表盘。
 *
 * 三份数据一起并发取（统计 / 读数 / 设置），任一份失败不影响其余两份 ——
 * 设置取不到时电费单价退回默认值 0.56，但用电量照常显示。
 */
export default function DashboardPage() {
  const { values, errors, isInitialLoading, isInitialFailed, reload } = useAsyncAll(
    {
      stats: statsApi.get,
      readings: readingsApi.list,
      settings: settingsApi.get,
    },
    [],
    [],
  );

  // 停留期间每 30 秒重拉一次，页面切走时不刷（见 use-heartbeat）
  useHeartbeat(() => void reload(), REFRESH_MS);

  if (isInitialFailed) {
    return (
      <>
        <PageHeader title="仪表盘" description="电表运行概览" />
        <LoadError className="py-24" error={errors.stats ?? errors.readings} onRetry={reload} />
      </>
    );
  }

  const stats = values.stats;
  const readings = values.readings ?? [];
  const rate = Number(values.settings?.rate_per_kwh ?? 0.56);

  return (
    <div className="space-y-5">
      <PageHeader
        title="仪表盘"
        description={
          stats ? `共 ${fmtNumber(stats.totalReadings, 0)} 条读数 · 单价 ${fmtMoney(rate)}/度` : "电表运行概览"
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="本月用电"
          value={`${fmtKwh(stats?.currentMonthConsumed)} 度`}
          icon={Zap}
          tone="accent"
          loading={isInitialLoading}
        />
        <StatCard
          label="本月费用"
          value={fmtMoney(stats?.currentMonthAmount)}
          icon={Coins}
          tone="accent"
          loading={isInitialLoading}
        />
        <StatCard
          label="累计用电"
          value={`${fmtKwh(stats?.totalConsumed)} 度`}
          icon={Gauge}
          loading={isInitialLoading}
        />
        <StatCard
          label="累计费用"
          value={fmtMoney(stats?.totalAmount)}
          icon={ChartLine}
          loading={isInitialLoading}
        />
      </div>

      {errors.settings ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          设置读取失败，电费按默认单价 {fmtMoney(0.56)}/度 估算。
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>用电趋势</CardTitle>
          <p className="text-xs text-muted-foreground">最近 6 个月的日均用电量</p>
        </CardHeader>
        <CardContent>
          {isInitialLoading ? (
            <div className="h-[280px] w-full animate-pulse rounded-md bg-muted" />
          ) : readings.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title="还没有读数记录"
              description="去「读数记录」添加第一条，趋势图就会出现在这里。"
            />
          ) : (
            <UsageChart readings={readings} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
