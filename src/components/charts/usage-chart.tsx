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
    if (!acc[date] || (r.reading_time ?? '') > (acc[date].reading_time ?? '')) {
      acc[date] = r;
    }
    return acc;
  }, {} as Record<string, Reading>);

  const sortedEntries = Object.entries(lastReadingOfDay)
    .map(([date, reading]) => ({ date, reading }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sortedEntries.length === 0) {
    return <div className="text-center py-4 text-gray-500">暂无读数数据</div>;
  }

  // Interpolate reading value at a given date (linear between adjacent readings)
  // For dates before the first reading, returns null (unknown)
  function interpolateAtDate(targetDate: string): number | null {
    if (sortedEntries.length === 0) return null;
    if (targetDate < sortedEntries[0].date) return null;
    if (targetDate >= sortedEntries[sortedEntries.length - 1].date) return sortedEntries[sortedEntries.length - 1].reading.reading_value;

    for (let i = 0; i < sortedEntries.length - 1; i++) {
      const a = sortedEntries[i];
      const b = sortedEntries[i + 1];
      if (targetDate >= a.date && targetDate <= b.date) {
        if (a.date === b.date) return a.reading.reading_value;
        const tA = new Date(a.date).getTime();
        const tB = new Date(b.date).getTime();
        const tTarget = new Date(targetDate).getTime();
        const ratio = (tTarget - tA) / (tB - tA);
        return a.reading.reading_value + (b.reading.reading_value - a.reading.reading_value) * ratio;
      }
    }
    return null;
  }

  // Determine which months have data
  const allMonths = new Set<string>();
  sortedEntries.forEach(e => allMonths.add(e.date.substring(0, 7)));
  const sortedMonths = Array.from(allMonths).sort();

  // Calculate daily average per month using boundary interpolation
  const monthlyData: Record<string, { dailyAvg: number; totalConsumed: number; days: number }> = {};
  for (const month of sortedMonths) {
    const [y, m] = month.split('-').map(Number);
    const firstDay = `${month}-01`;

    const monthReadings = sortedEntries.filter(e => e.date.substring(0, 7) === month);
    const firstReading = monthReadings[0];
    const lastReading = monthReadings[monthReadings.length - 1];
    if (!firstReading || !lastReading) continue;

    let startValue = interpolateAtDate(firstDay);
    if (startValue === null) {
      startValue = firstReading.reading.previous_reading ?? firstReading.reading.reading_value;
    }

    const endValue = lastReading.reading.reading_value;
    const endDate = lastReading.date;
    const daysCovered = Math.max(1, Math.round(
      (new Date(endDate).getTime() - new Date(firstDay).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1);

    const consumed = Math.max(0, endValue - startValue);
    monthlyData[month] = { dailyAvg: consumed / daysCovered, totalConsumed: consumed, days: daysCovered };
  }

  const months = sortedMonths.slice(-6);
  const monthlyAvg = months.map(m => monthlyData[m]?.dailyAvg ?? 0);

  const chartData = {
    labels: months.map(m => `${m.substring(5)}月`),
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
