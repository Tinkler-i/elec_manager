"use client";

import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DailyUsageChart = dynamic(() => import("@/components/charts/daily-usage-chart").then(m => ({ default: m.DailyUsageChart })), { loading: () => <div className="h-[400px] flex items-center justify-center">加载中...</div> });
const MonthlyComparisonChart = dynamic(() => import("@/components/charts/monthly-comparison-chart").then(m => ({ default: m.MonthlyComparisonChart })), { loading: () => <div className="h-[400px] flex items-center justify-center">加载中...</div> });
const AnnualAnalysisChart = dynamic(() => import("@/components/charts/annual-analysis-chart").then(m => ({ default: m.AnnualAnalysisChart })), { loading: () => <div className="h-[400px] flex items-center justify-center">加载中...</div> });

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">数据分析</h1>

      {/* 日用电量详情 */}
      <DailyUsageChart />

      {/* 月度对比 */}
      <Card>
        <CardHeader>
          <CardTitle>月度用电对比</CardTitle>
          <p className="text-xs text-gray-500 mt-1">最近6个月</p>
        </CardHeader>
        <CardContent>
          <MonthlyComparisonChart />
        </CardContent>
      </Card>

      {/* 年度深度分析 */}
      <Card>
        <CardHeader>
          <CardTitle>年度深度分析</CardTitle>
        </CardHeader>
        <CardContent>
          <AnnualAnalysisChart />
        </CardContent>
      </Card>
    </div>
  );
}
