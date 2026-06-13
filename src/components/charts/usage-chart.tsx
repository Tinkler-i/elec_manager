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
  Filler,
} from "chart.js";
import { Reading } from "@/types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export function UsageChart() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReadings();
  }, []);

  async function fetchReadings() {
    try {
      const response = await fetch("/api/readings");
      const data = await response.json();
      setReadings(data.sort((a: Reading, b: Reading) => a.reading_date.localeCompare(b.reading_date)));
    } catch (error) {
      console.error("获取读数失败:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-center py-4">加载中...</div>;
  }

  if (readings.length === 0) {
    return <div className="text-center py-4 text-gray-500">暂无读数数据</div>;
  }

  // Get the last reading of each day
  const lastReadingOfDay = readings.reduce((acc, r) => {
    const date = r.reading_date;
    if (!acc[date] || r.reading_date > acc[date].reading_date) {
      acc[date] = r;
    }
    return acc;
  }, {} as Record<string, Reading>);

  // Get last 90 days
  const today = new Date();
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);

  const recentDays = Object.entries(lastReadingOfDay)
    .filter(([date]) => new Date(date) >= ninetyDaysAgo)
    .map(([date, reading]) => ({ date, reading }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (recentDays.length === 0) {
    return <div className="text-center py-4 text-gray-500">最近90天暂无数据</div>;
  }

  // Calculate monthly data from daily readings
  const monthlyData: Record<string, { count: number; total: number }> = {};
  recentDays.forEach(({ date, reading }) => {
    const month = date.substring(0, 7);
    if (!monthlyData[month]) {
      monthlyData[month] = { count: 0, total: 0 };
    }
    monthlyData[month].total += reading.units_consumed || 0;
    monthlyData[month].count += 1;
  });

  const months = Object.keys(monthlyData).sort();
  const monthLabels = months.map(m => `${m.substring(5)}月`);
  const monthlyAvg = months.map(m => monthlyData[m].total / monthlyData[m].count);

  const chartData = {
    labels: monthLabels,
    datasets: [
      {
        label: "日均用电 (度)",
        data: monthlyAvg,
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        tension: 0.3,
        fill: true,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
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

  return <Line data={chartData} options={options} />;
}
