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

export function AnnualAnalysisChart() {
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

  const dataByYearMonth: Record<string, Record<string, Reading>> = {};
  readings.forEach(r => {
    const yearMonth = r.reading_date.substring(0, 7);
    const year = yearMonth.substring(0, 4);
    
    if (!dataByYearMonth[year]) {
      dataByYearMonth[year] = {};
    }
    
    const month = yearMonth.substring(5, 7);
    if (!dataByYearMonth[year][month] || r.reading_date > dataByYearMonth[year][month].reading_date) {
      dataByYearMonth[year][month] = r;
    }
  });

  const years = Object.keys(dataByYearMonth).sort();

  const allMonths = new Set<string>();
  Object.values(dataByYearMonth).forEach(yearData => {
    Object.keys(yearData).forEach(month => allMonths.add(month));
  });
  const sortedMonths = Array.from(allMonths).sort();
  const monthLabels = sortedMonths.map(m => `${m}月`);

  let maxUsage = 0;
  const datasets = years.map((year, yearIndex) => {
    const colors = [
      { border: "rgb(59, 130, 246)", bg: "rgba(59, 130, 246, 0.1)" },
      { border: "rgb(239, 68, 68)", bg: "rgba(239, 68, 68, 0.1)" },
      { border: "rgb(34, 197, 94)", bg: "rgba(34, 197, 94, 0.1)" },
      { border: "rgb(168, 85, 247)", bg: "rgba(168, 85, 247, 0.1)" },
      { border: "rgb(251, 146, 60)", bg: "rgba(251, 146, 60, 0.1)" },
    ];
    const colorIndex = yearIndex % colors.length;

    const monthData = sortedMonths.map((month, monthIndex) => {
      const currentReading = dataByYearMonth[year]?.[month];
      if (!currentReading) return null;

      const prevMonth = monthIndex > 0 ? sortedMonths[monthIndex - 1] : null;
      const prevReading = prevMonth ? dataByYearMonth[year]?.[prevMonth] : null;

      const consumed = prevReading
        ? currentReading.reading_value - prevReading.reading_value
        : currentReading.reading_value - (currentReading.previous_reading || 0);

      const val = Math.max(0, consumed);
      if (val > maxUsage) maxUsage = val;
      return val;
    });

    return {
      label: year,
      data: monthData,
      borderColor: colors[colorIndex].border,
      backgroundColor: colors[colorIndex].bg,
      borderWidth: 2,
      tension: 0.3,
      fill: false,
      yAxisID: "y",
    };
  });

  const chartData = {
    labels: monthLabels,
    datasets,
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
      },
      title: {
        display: true,
        text: "年度对比",
      },
      tooltip: {
        callbacks: {
          label: function(context: { dataset: { label?: string }; parsed: { y: number | null } }) {
            const usage = context.parsed.y;
            if (usage === null) return "";
            const cost = (usage * rate).toFixed(2);
            return `${context.dataset.label}: ${usage.toFixed(1)} 度 (¥${cost})`;
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
        beginAtZero: true,
        title: {
          display: true,
          text: "月用电量 (度)",
        },
      },
      y1: {
        type: "linear" as const,
        display: true,
        position: "right" as const,
        beginAtZero: true,
        max: Math.ceil(maxUsage * rate),
        title: {
          display: true,
          text: "月电费 (元)",
        },
        grid: {
          drawOnChartArea: false,
        },
      },
    },
  };

  return (
    <div className="h-[400px]">
      <Line data={chartData} options={options} />
    </div>
  );
}
