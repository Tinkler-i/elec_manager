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
import { Reading } from "@/types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export function UsageChart() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState(0.56);

  useEffect(() => {
    fetchReadings();
    fetchSettings();
  }, []);

  async function fetchReadings() {
    try {
      const response = await fetch("/api/readings");
      const data = await response.json();
      setReadings(data.slice(0, 12).reverse());
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

  if (loading) {
    return <div className="text-center py-4">加载中...</div>;
  }

  if (readings.length === 0) {
    return <div className="text-center py-4 text-gray-500">暂无读数数据</div>;
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
        label: "用电量 (度)",
        data: dailyConsumed,
        borderColor: "rgb(59, 130, 246)",
        backgroundColor: "rgba(59, 130, 246, 0.5)",
        tension: 0.3,
      },
      {
        label: "费用 (元)",
        data: dailyConsumed.map(v => v * rate),
        borderColor: "rgb(239, 68, 68)",
        backgroundColor: "rgba(239, 68, 68, 0.5)",
        tension: 0.3,
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
