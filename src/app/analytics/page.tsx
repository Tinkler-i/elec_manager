import { ChartLine } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { AnnualAnalysisChart } from "@/components/charts/annual-analysis-chart";
import { DailyUsageChart } from "@/components/charts/daily-usage-chart";
import { MonthlyComparisonChart } from "@/components/charts/monthly-comparison-chart";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRatePerKwh, getReadings } from "@/lib/db";

/**
 * 读数据库的页面必须显式声明动态渲染，否则读数会在 build 时被烤进 HTML。
 * 原因见 docs/coding-standards.md 与 src/app/page.tsx 的同一段注释。
 */
export const dynamic = "force-dynamic";

/** 分析图不用刷得那么勤；标签页隐藏时跳过、切回来立即刷一次（见 use-heartbeat） */
const REFRESH_MS = 60_000;

/**
 * 数据分析。
 *
 * 三张图共用同一份读数与单价，单价由服务端取好、按 props 传下去（图表里不再
 * 自己取数，也不会因为拿不到设置而退回默认值）。
 */
export default function AnalyticsPage() {
  const readings = getReadings();
  const rate = getRatePerKwh();

  return (
    <div className="space-y-5">
      <AutoRefresh intervalMs={REFRESH_MS} />

      <PageHeader title="数据分析" description="日均用电、月度对比与年度趋势" />

      {readings.length === 0 ? (
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
          <DailyUsageChart readings={readings} rate={rate} />

          <Card>
            <CardHeader>
              <CardTitle>月度用电对比</CardTitle>
              <p className="text-xs text-muted-foreground">最近 6 个月，悬浮查看电费</p>
            </CardHeader>
            <CardContent>
              <MonthlyComparisonChart readings={readings} rate={rate} />
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
              <AnnualAnalysisChart readings={readings} rate={rate} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
