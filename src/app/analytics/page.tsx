"use client";

import { ChartLine } from "lucide-react";

import { AnnualAnalysisChart } from "@/components/charts/annual-analysis-chart";
import { DailyUsageChart } from "@/components/charts/daily-usage-chart";
import { MonthlyComparisonChart } from "@/components/charts/monthly-comparison-chart";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadError } from "@/components/layout/load-error";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readingsApi, settingsApi } from "@/lib/api";
import { useAsyncAll } from "@/lib/use-async-data";
import { useHeartbeat } from "@/lib/use-heartbeat";

const REFRESH_MS = 60_000;

/**
 * 数据分析。
 *
 * 三张图共用同一份读数与单价：原来三个图表组件各自 fetch 一遍 `/api/readings`
 * 和 `/api/settings`，进这一页要打 6 个请求，其中 4 个是重复的。
 */
export default function AnalyticsPage() {
  const { values, errors, isInitialLoading, isInitialFailed, reload } = useAsyncAll({
    readings: readingsApi.list,
    settings: settingsApi.get,
  });

  useHeartbeat(() => void reload(), REFRESH_MS);

  if (isInitialFailed) {
    return (
      <>
        <PageHeader title="数据分析" description="用电趋势与对比" />
        <LoadError className="py-24" error={errors.readings} onRetry={reload} />
      </>
    );
  }

  const readings = values.readings ?? [];
  const rate = Number(values.settings?.rate_per_kwh ?? 0.56);
  const empty = !isInitialLoading && readings.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="数据分析" description="日均用电、月度对比与年度趋势" />

      {empty ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ChartLine}
              title="还没有读数记录"
              description="分析图需要至少两条读数才能画出趋势。"
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <DailyUsageChart readings={readings} rate={rate} loading={isInitialLoading} />

          <Card>
            <CardHeader>
              <CardTitle>月度用电对比</CardTitle>
              <p className="text-xs text-muted-foreground">最近 6 个月，悬浮查看电费</p>
            </CardHeader>
            <CardContent>
              {isInitialLoading ? (
                <div className="h-[320px] w-full animate-pulse rounded-md bg-muted" />
              ) : (
                <MonthlyComparisonChart readings={readings} rate={rate} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>年度深度分析</CardTitle>
              <p className="text-xs text-muted-foreground">
                逐年对比各月用电量；没有抄表的月份曲线会断开，与「用了 0 度」区分开
              </p>
            </CardHeader>
            <CardContent>
              {isInitialLoading ? (
                <div className="h-[360px] w-full animate-pulse rounded-md bg-muted" />
              ) : (
                <AnnualAnalysisChart readings={readings} rate={rate} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
