"use client";

import { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Reading } from "@/types";
import { Calendar } from "lucide-react";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export function DailyUsageChart() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState(0.56);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  useEffect(() => {
    fetchReadings();
    fetchSettings();
  }, [startDate, endDate]);

  async function fetchReadings() {
    setLoading(true);
    try {
      const response = await fetch("/api/readings");
      const allData = await response.json();
      const filteredData = allData
        .filter((r: Reading) => r.reading_date >= startDate && r.reading_date <= endDate)
        .sort((a: Reading, b: Reading) => a.reading_date.localeCompare(b.reading_date));
      setReadings(filteredData);
    } catch (error) {
      console.error("获取读数失败:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSettings() {
    try {
      const response = await fetch("/api/settings");
      const data = await response.json();
      if (data.rate_per_kwh) {
        setRate(parseFloat(data.rate_per_kwh));
      }
    } catch (error) {
      console.error("获取设置失败:", error);
    }
  }

  function handleQuickSelect(months: number) {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  }

  const dailyData = readings.reduce((acc, r) => {
    const date = r.reading_date;
    if (!acc[date]) {
      acc[date] = 0;
    }
    acc[date] += r.units_consumed || 0;
    return acc;
  }, {} as Record<string, number>);

  const sortedDates = Object.keys(dailyData).sort();
  const dailyConsumed = sortedDates.map(d => dailyData[d]);

  const chartData = {
    labels: sortedDates,
    datasets: [
      {
        label: "日用电量 (度)",
        data: dailyConsumed,
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.5)",
        tension: 0.3,
        fill: true,
      },
      {
        label: "日费用 (元)",
        data: dailyConsumed.map(v => v * rate),
        borderColor: "rgb(239, 68, 68)",
        backgroundColor: "rgba(239, 68, 68, 0.3)",
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const options = {
    responsive: true,
    interaction: {
      intersect: false,
      mode: "index" as const,
    },
    plugins: {
      legend: {
        position: "top" as const,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle>日用电量</CardTitle>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleQuickSelect(1)}>近1月</Button>
              <Button variant="outline" size="sm" onClick={() => handleQuickSelect(3)}>近3月</Button>
              <Button variant="outline" size="sm" onClick={() => handleQuickSelect(6)}>近6月</Button>
              <Button variant="outline" size="sm" onClick={() => handleQuickSelect(12)}>近1年</Button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <Calendar className="w-4 h-4 text-gray-500" />
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-[140px]"
                />
              </div>
              <span className="text-gray-500">至</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-[140px]"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8">加载中...</div>
        ) : readings.length === 0 ? (
          <div className="text-center py-8 text-gray-500">该时间段内暂无读数数据</div>
        ) : (
          <div className="h-[400px]">
            <Line data={chartData} options={options} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
