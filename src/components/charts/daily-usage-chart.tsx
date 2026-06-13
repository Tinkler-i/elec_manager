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

  const lastReadingOfDay = readings.reduce((acc, r) => {
    const date = r.reading_date;
    if (!acc[date] || r.reading_date > acc[date].reading_date) {
      acc[date] = r;
    }
    return acc;
  }, {} as Record<string, Reading>);

  const dailyData = Object.entries(lastReadingOfDay).reduce((acc, [date, reading]) => {
    acc[date] = reading.units_consumed || 0;
    return acc;
  }, {} as Record<string, number>);

  const sortedDates = Object.keys(dailyData).sort();
  const dailyConsumed = sortedDates.map(d => dailyData[d]);
  const maxUsage = Math.max(...dailyConsumed);

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
        yAxisID: "y",
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: "index" as const,
    },
    plugins: {
      legend: {
        position: "top" as const,
      },
      tooltip: {
        callbacks: {
          label: function(context: { dataset: { label?: string }; parsed: { y: number | null }; dataIndex: number }) {
            const usage = context.parsed.y;
            if (usage === null) return "";
            const cost = (usage * rate).toFixed(2);
            return `用电: ${usage.toFixed(1)} 度 | 电费: ¥${cost}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxRotation: 45,
          minRotation: 45,
          maxTicksLimit: 20,
        },
        grid: {
          display: false,
        },
      },
      y: {
        type: "linear" as const,
        display: true,
        position: "left" as const,
        title: {
          display: true,
          text: "用电量 (度)",
        },
        beginAtZero: true,
      },
      y1: {
        type: "linear" as const,
        display: true,
        position: "right" as const,
        beginAtZero: true,
        max: Math.ceil(maxUsage * rate),
        title: {
          display: true,
          text: "电费 (元)",
        },
        grid: {
          drawOnChartArea: false,
        },
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
