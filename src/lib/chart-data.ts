import type { Reading } from "@/types";

/**
 * 四张图的取数逻辑 —— 纯函数，零依赖。
 *
 * 从原来的 chart.js 组件里原样搬出来（`usage-chart.tsx` / `daily-usage-chart.tsx` /
 * `monthly-comparison-chart.tsx` / `annual-analysis-chart.tsx`），**算法一个字没改**，
 * 只是把「算数据」和「画数据」分开：
 *
 *  · 换图表库（chart.js → recharts）只动渲染层，不再有重写算法的风险；
 *  · 这些函数能直接用 node 跑（见 chart-data.test.mjs），不用起浏览器。
 *
 * 原来的注释里写明的口径（跨多天读数按日均、首月用 previous_reading 兜底、
 * 用电量下限为 0）都保留 —— 它们是被 README 记录过的行为。
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** 按日期升序 */
function byDate(a: Reading, b: Reading): number {
  return a.reading_date.localeCompare(b.reading_date);
}

/** 同一天里按时间升序（时间为空串时排最前，与原实现一致） */
function byTime(a: Reading, b: Reading): number {
  return (a.reading_time ?? "").localeCompare(b.reading_time ?? "");
}

/** 每天取最后一条读数（时间为空则取第一条） */
export function lastReadingOfDay(readings: Reading[]): Reading[] {
  const acc: Record<string, Reading> = {};
  for (const r of readings) {
    const date = r.reading_date;
    if (!acc[date] || (r.reading_time ?? "") > (acc[date].reading_time ?? "")) {
      acc[date] = r;
    }
  }
  return Object.entries(acc)
    .map(([date, reading]) => ({ date, reading }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => e.reading);
}

export interface MonthlyDailyAverage {
  month: string;
  label: string;
  dailyAvg: number;
  totalConsumed: number;
  days: number;
}

/**
 * 仪表盘「用电趋势」：最近 N 个月的日均用电。
 *
 * 月度用电量用**边界插值**求月初的表读数，而不是拿当月第一条读数顶替 ——
 * 当月第一次抄表通常在中旬，直接用它的 previous_reading 会把半个月的量算进
 * 这个月。跨月的读数为空时退回第一条读数的 previous_reading。
 */
export function monthlyDailyAverage(readings: Reading[], limit = 6): MonthlyDailyAverage[] {
  const sorted = [...readings].sort(byDate);
  const daily = lastReadingOfDay(sorted);
  if (daily.length === 0) return [];

  const entries = daily.map((reading) => ({ date: reading.reading_date, reading }));

  function interpolateAtDate(targetDate: string): number | null {
    if (entries.length === 0) return null;
    if (targetDate < entries[0].date) return null;
    if (targetDate >= entries[entries.length - 1].date) {
      return entries[entries.length - 1].reading.reading_value;
    }
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i];
      const b = entries[i + 1];
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

  const allMonths = new Set<string>();
  entries.forEach((e) => allMonths.add(e.date.substring(0, 7)));
  const sortedMonths = Array.from(allMonths).sort();

  const out: MonthlyDailyAverage[] = [];
  for (const month of sortedMonths) {
    const firstDay = `${month}-01`;
    const monthEntries = entries.filter((e) => e.date.substring(0, 7) === month);
    const firstReading = monthEntries[0];
    const lastReading = monthEntries[monthEntries.length - 1];
    if (!firstReading || !lastReading) continue;

    let startValue = interpolateAtDate(firstDay);
    if (startValue === null) {
      startValue = firstReading.reading.previous_reading ?? firstReading.reading.reading_value;
    }

    const endValue = lastReading.reading.reading_value;
    const endDate = lastReading.date;
    const daysCovered = Math.max(
      1,
      Math.round((new Date(endDate).getTime() - new Date(firstDay).getTime()) / MS_PER_DAY) + 1,
    );

    const consumed = Math.max(0, endValue - startValue);
    out.push({
      month,
      label: `${month.substring(5)}月`,
      dailyAvg: consumed / daysCovered,
      totalConsumed: consumed,
      days: daysCovered,
    });
  }

  return out.slice(-limit);
}

export interface DailyUsagePoint {
  date: string;
  label: string;
  /** 日均用电量。区间内第一天没有前一天可比，固定为 0 */
  dailyAvg: number;
  /** 与上一条读数之间的用电量 */
  totalConsumed: number;
  /** 与上一条读数相隔的天数。第一天为 0 */
  days: number;
  /** 该区间电费 */
  cost: number;
}

/**
 * 分析页「日均用电量」：把区间内的读数折算成每日用电。
 *
 * 跨多天的两条读数（比如出差两周只抄了一次）不能算成"当天用了 N 度"，
 * 要除以间隔天数 —— 否则那根柱子会高得离谱，整张图的纵轴被它一个人拉走。
 */
export function dailyUsage(readings: Reading[], rate: number): DailyUsagePoint[] {
  const groups: Record<string, Reading[]> = {};
  readings.forEach((r) => {
    const date = r.reading_date;
    if (!groups[date]) groups[date] = [];
    groups[date].push(r);
  });

  const dates = Object.keys(groups).sort();
  const out: DailyUsagePoint[] = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const dayReadings = [...groups[date]].sort(byTime);
    const lastOfDay = dayReadings[dayReadings.length - 1];

    let consumed: number;
    let days: number;
    if (i === 0) {
      // 区间第一天没有前一天可减，用后端算好的 units_consumed；日均无法定义
      consumed = lastOfDay.units_consumed || 0;
      days = 0;
    } else {
      const prevDate = new Date(dates[i - 1]);
      const curDate = new Date(date);
      days = Math.max(1, Math.round((curDate.getTime() - prevDate.getTime()) / MS_PER_DAY));
      const prevDayReadings = [...groups[dates[i - 1]]].sort(byTime);
      const lastOfPrevDay = prevDayReadings[prevDayReadings.length - 1];
      consumed = lastOfDay.reading_value - lastOfPrevDay.reading_value;
    }

    out.push({
      date,
      label: date.length >= 10 ? date.slice(5) : date,
      dailyAvg: days === 0 ? 0 : consumed / days,
      totalConsumed: consumed,
      days,
      cost: consumed * rate,
    });
  }

  return out;
}

export interface MonthlyConsumption {
  month: string;
  label: string;
  consumed: number;
}

/**
 * 分析页「月度用电对比」：最近 N 个月各用了多少度。
 *
 * 首月没有上个月可减，用当月第一条读数的 previous_reading 作为基线。
 */
export function monthlyConsumption(readings: Reading[], limit = 6): MonthlyConsumption[] {
  const lastOfMonth: Record<string, Reading> = {};
  const firstOfMonth: Record<string, Reading> = {};

  readings.forEach((r) => {
    const month = r.reading_date.substring(0, 7);
    if (!lastOfMonth[month] || r.reading_date > lastOfMonth[month].reading_date) lastOfMonth[month] = r;
    if (!firstOfMonth[month] || r.reading_date < firstOfMonth[month].reading_date) firstOfMonth[month] = r;
  });

  const months = Object.keys(lastOfMonth).sort();
  return months
    .map((month, index) => {
      const current = lastOfMonth[month];
      const prev = index > 0 ? lastOfMonth[months[index - 1]] : null;
      const consumed = prev
        ? current.reading_value - prev.reading_value
        : current.reading_value - (firstOfMonth[month]?.previous_reading ?? 0);
      return { month, label: `${month.substring(5)}月`, consumed: Math.max(0, consumed) };
    })
    .slice(-limit);
}

export interface AnnualSeries {
  /** 横轴：01..12（只包含有数据的月份） */
  months: string[];
  /** 每年一条线。`points[i]` 为 null 表示该年这个月没有读数 */
  years: { year: string; points: (number | null)[] }[];
}

/**
 * 分析页「年度深度分析」：按年对比逐月用电量。
 *
 * 某年某月没数据时给 null（不是 0）—— recharts 的 `connectNulls=false` 会把
 * 断点两侧断开，这正是我们要的：0 表示"这个月一度电没用"，null 表示"没抄表"，
 * 两者在图上必须能区分。
 */
export function annualSeries(readings: Reading[]): AnnualSeries {
  const lastOfYearMonth: Record<string, Record<string, Reading>> = {};
  const firstOfYearMonth: Record<string, Record<string, Reading>> = {};

  readings.forEach((r) => {
    const yearMonth = r.reading_date.substring(0, 7);
    const year = yearMonth.substring(0, 4);
    const month = yearMonth.substring(5, 7);

    if (!lastOfYearMonth[year]) {
      lastOfYearMonth[year] = {};
      firstOfYearMonth[year] = {};
    }
    if (!lastOfYearMonth[year][month] || r.reading_date > lastOfYearMonth[year][month].reading_date) {
      lastOfYearMonth[year][month] = r;
    }
    if (!firstOfYearMonth[year][month] || r.reading_date < firstOfYearMonth[year][month].reading_date) {
      firstOfYearMonth[year][month] = r;
    }
  });

  const years = Object.keys(lastOfYearMonth).sort();
  const monthSet = new Set<string>();
  years.forEach((y) => Object.keys(lastOfYearMonth[y]).forEach((m) => monthSet.add(m)));
  const months = Array.from(monthSet).sort();

  const series = years.map((year) => {
    const points = months.map((month, monthIndex) => {
      const current = lastOfYearMonth[year]?.[month];
      if (!current) return null;

      const prevMonth = monthIndex > 0 ? months[monthIndex - 1] : null;
      const prev = prevMonth ? lastOfYearMonth[year]?.[prevMonth] : null;

      const consumed = prev
        ? current.reading_value - prev.reading_value
        : current.reading_value - (firstOfYearMonth[year]?.[month]?.previous_reading ?? 0);

      return Math.max(0, consumed);
    });
    return { year, points };
  });

  return { months, years: series };
}

/** recharts 的横轴数据：把「月份 + 每年一条线」转成按月的对象数组 */
export function annualChartRows(series: AnnualSeries): Record<string, string | number | null>[] {
  return series.months.map((month, i) => {
    const row: Record<string, string | number | null> = { label: `${month}月` };
    series.years.forEach((y) => {
      row[y.year] = y.points[i];
    });
    return row;
  });
}
