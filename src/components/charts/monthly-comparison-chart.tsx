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

  const lastReadingOfMonth = readings.reduce((acc, r) => {
    const month = r.reading_date.substring(0, 7);
    if (!acc[month] || r.reading_date > acc[month].reading_date) {
      acc[month] = r;
    }
    return acc;
  }, {} as Record<string, Reading>);

  const sortedMonths = Object.keys(lastReadingOfMonth).sort();
  
  const monthlyData: Record<string, number> = {};
  sortedMonths.forEach((month, index) => {
    const currentReading = lastReadingOfMonth[month];
    const prevReading = index > 0 ? lastReadingOfMonth[sortedMonths[index - 1]] : null;
    
    const consumed = prevReading 
      ? currentReading.reading_value - prevReading.reading_value
      : currentReading.reading_value - (currentReading.previous_reading || 0);
    
    monthlyData[month] = Math.max(0, consumed);
  });

  const months = sortedMonths.slice(-6);
  const maxUsage = Math.max(...months.map(m => monthlyData[m]));

  const chartData = {
    labels: months.map(m => `${m.substring(5)}月`),
    datasets: [
      {
        label: "用电量 (度)",
        data: months.map(m => monthlyData[m]),
        backgroundColor: "rgba(59, 130, 246, 0.7)",
        borderColor: "rgb(59, 130, 246)",
        borderWidth: 1,
        yAxisID: "y",
      },
    ],
  };

  const options = {
    responsive: true,
    interaction: {
      mode: "index" as const,
      intersect: false,
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
        title: {
          display: true,
          text: "电费 (元)",
        },
        beginAtZero: true,
        max: Math.ceil(maxUsage * rate),
        grid: {
          drawOnChartArea: false,
        },
      },
    },
  };

  return <Bar data={chartData} options={options} />;
}
