"use client";

import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DailyUsageChart = dynamic(() => import("@/components/charts/daily-usage-chart").then(m => ({ default: m.DailyUsageChart })), { loading: () => <div className="h-[400px] flex items-center justify-center">加载中...</div> });
const UsageChart = dynamic(() => import("@/components/charts/usage-chart").then(m => ({ default: m.UsageChart })), { loading: () => <div className="h-[300px] flex items-center justify-center">加载中...</div> });
const MonthlyComparisonChart = dynamic(() => import("@/components/charts/monthly-comparison-chart").then(m => ({ default: m.MonthlyComparisonChart })), { loading: () => <div className="h-[300px] flex items-center justify-center">加载中...</div> });

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">数据分析</h1>

      <DailyUsageChart />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>用电趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageChart />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>月度对比</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyComparisonChart />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
