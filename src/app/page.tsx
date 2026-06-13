"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const UsageChart = dynamic(() => import("@/components/charts/usage-chart").then(m => ({ default: m.UsageChart })), { loading: () => <div className="h-[300px] flex items-center justify-center">加载中...</div> });

interface Stats {
  totalReadings: number;
  totalConsumed: number;
  totalAmount: number;
  currentMonthConsumed: number;
  currentMonthAmount: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const response = await fetch("/api/stats");
      if (!response.ok) {
        console.error("获取统计数据失败:", response.status);
        return;
      }
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error("获取统计数据失败:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">仪表盘</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">本月用电</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.currentMonthConsumed.toFixed(1)} 度</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">本月费用</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">¥{stats?.currentMonthAmount.toFixed(2)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">累计用电</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalConsumed.toFixed(1)} 度</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">累计费用</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">¥{stats?.totalAmount.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>用电趋势</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageChart />
        </CardContent>
      </Card>
    </div>
  );
}
