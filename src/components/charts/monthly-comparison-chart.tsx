"use client";

import { useEffect, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Reading } from "@/types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

export function MonthlyComparisonChart() {
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
      setReadings(data);
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

  const monthlyData = readings.reduce((acc, r) => {
    const month = r.reading_date.substring(0, 7);
    if (!acc[month]) {
      acc[month] = { consumed: 0, cost: 0 };
    }
    acc[month].consumed += r.units_consumed || 0;
    acc[month].cost += (r.units_consumed || 0) * rate;
    return acc;
  }, {} as Record<string, { consumed: number; cost: number }>);

  const months = Object.keys(monthlyData).sort().slice(-6);

  const chartData = {
    labels: months,
    datasets: [
      {
        label: "用电量 (度)",
        data: months.map(m => monthlyData[m].consumed),
        backgroundColor: "rgba(59, 130, 246, 0.7)",
      },
      {
        label: "费用 (元)",
        data: months.map(m => monthlyData[m].cost),
        backgroundColor: "rgba(239, 68, 68, 0.7)",
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

  return <Bar data={chartData} options={options} />;
}
