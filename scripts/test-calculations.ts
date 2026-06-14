// Test script for all calculation logic across the system
// Run: npx tsx scripts/test-calculations.ts

interface Reading {
  id: string;
  reading_value: number;
  reading_date: string;
  reading_time: string | null;
  previous_reading: number | null;
  units_consumed: number;
  notes: string | null;
  source: 'manual' | 'mcp' | 'import';
  created_by: string;
  is_verified: boolean;
  created_at: string;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string, actual?: unknown, expected?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
    if (actual !== undefined && expected !== undefined) {
      console.log(`    实际: ${actual}, 期望: ${expected}`);
    }
  }
}

function approxEqual(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) < epsilon;
}

function calcUnitsConsumed(readingValue: number, previousReading: number | null): number {
  return readingValue - (previousReading ?? 0);
}

function makeReading(date: string, value: number, prevReading: number | null, time?: string): Reading {
  return {
    id: `r-${date}`,
    reading_value: value,
    reading_date: date,
    reading_time: time ?? null,
    previous_reading: prevReading,
    units_consumed: calcUnitsConsumed(value, prevReading),
    notes: null,
    source: 'manual',
    created_by: 'user',
    is_verified: false,
    created_at: date,
  };
}

// ═══════════════════════════════════════════════════════════════════
// daily-usage-chart.tsx logic
// ═══════════════════════════════════════════════════════════════════
function calcDailyChartData(readings: Reading[]) {
  const dayGroups: Record<string, Reading[]> = {};
  readings.forEach(r => {
    const date = r.reading_date;
    if (!dayGroups[date]) dayGroups[date] = [];
    dayGroups[date].push(r);
  });
  const sortedDates = Object.keys(dayGroups).sort();

  const dailyData: { date: string; dailyAvg: number; totalConsumed: number; days: number }[] = [];
  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const dayReadings = dayGroups[date].sort((a, b) => (a.reading_time ?? '').localeCompare(b.reading_time ?? ''));
    const firstOfDay = dayReadings[0];
    const lastOfDay = dayReadings[dayReadings.length - 1];

    if (i === 0) {
      const consumed = lastOfDay.units_consumed || 0;
      dailyData.push({ date, dailyAvg: 0, totalConsumed: consumed, days: 0 });
    } else {
      const prevDate = new Date(sortedDates[i - 1]);
      const curDate = new Date(date);
      const daysDiff = Math.max(1, Math.round((curDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)));
      const consumed = lastOfDay.reading_value - (firstOfDay.previous_reading ?? 0);
      dailyData.push({ date, dailyAvg: consumed / daysDiff, totalConsumed: consumed, days: daysDiff });
    }
  }
  return dailyData;
}

// ═══════════════════════════════════════════════════════════════════
// usage-chart.tsx logic
// ═══════════════════════════════════════════════════════════════════
function lastReadingOfDay(readings: Reading[]): Record<string, Reading> {
  return readings.reduce((acc, r) => {
    const date = r.reading_date;
    if (!acc[date] || (r.reading_time ?? '') > (acc[date].reading_time ?? '')) {
      acc[date] = r;
    }
    return acc;
  }, {} as Record<string, Reading>);
}

function interpolateAtDate(sortedEntries: { date: string; reading: Reading }[], targetDate: string): number | null {
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

function calcUsageChartData(readings: Reading[]) {
  const lastDay = lastReadingOfDay(readings);
  const sortedEntries = Object.entries(lastDay)
    .map(([date, reading]) => ({ date, reading }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const allMonths = new Set<string>();
  sortedEntries.forEach(e => allMonths.add(e.date.substring(0, 7)));
  const sortedMonths = Array.from(allMonths).sort();

  const monthlyData: Record<string, { dailyAvg: number; totalConsumed: number; days: number }> = {};
  for (const month of sortedMonths) {
    const [y, m] = month.split('-').map(Number);
    const firstDay = `${month}-01`;

    const monthReadings = sortedEntries.filter(e => e.date.substring(0, 7) === month);
    const firstReading = monthReadings[0];
    const lastReading = monthReadings[monthReadings.length - 1];
    if (!firstReading || !lastReading) continue;

    let startValue = interpolateAtDate(sortedEntries, firstDay);
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
  return monthlyData;
}

// ═══════════════════════════════════════════════════════════════════
// stats/route.ts logic
// ═══════════════════════════════════════════════════════════════════
function calcStats(readings: Reading[], currentMonth: string) {
  const lastReadingOfMonth: Record<string, Reading> = {};
  const firstReadingOfMonth: Record<string, Reading> = {};
  readings.forEach(r => {
    const month = r.reading_date.substring(0, 7);
    if (!lastReadingOfMonth[month] || r.reading_date > lastReadingOfMonth[month].reading_date) {
      lastReadingOfMonth[month] = r;
    }
    if (!firstReadingOfMonth[month] || r.reading_date < firstReadingOfMonth[month].reading_date) {
      firstReadingOfMonth[month] = r;
    }
  });

  const sortedMonths = Object.keys(lastReadingOfMonth).sort();
  let totalConsumed = 0;
  let currentMonthConsumed = 0;

  sortedMonths.forEach((month, index) => {
    const currentReading = lastReadingOfMonth[month];
    const prevReading = index > 0 ? lastReadingOfMonth[sortedMonths[index - 1]] : null;

    let monthConsumed: number;
    if (prevReading) {
      monthConsumed = currentReading.reading_value - prevReading.reading_value;
    } else {
      const firstReading = firstReadingOfMonth[month];
      const baseline = firstReading?.previous_reading ?? 0;
      monthConsumed = currentReading.reading_value - baseline;
    }

    totalConsumed += Math.max(0, monthConsumed);
    if (month === currentMonth) currentMonthConsumed = Math.max(0, monthConsumed);
  });

  return { totalConsumed, currentMonthConsumed };
}

// ═══════════════════════════════════════════════════════════════════
// monthly-comparison logic
// ═══════════════════════════════════════════════════════════════════
function calcMonthlyComparison(readings: Reading[]) {
  const lastReadingOfMonth: Record<string, Reading> = {};
  const firstReadingOfMonth: Record<string, Reading> = {};
  readings.forEach(r => {
    const month = r.reading_date.substring(0, 7);
    if (!lastReadingOfMonth[month] || r.reading_date > lastReadingOfMonth[month].reading_date) {
      lastReadingOfMonth[month] = r;
    }
    if (!firstReadingOfMonth[month] || r.reading_date < firstReadingOfMonth[month].reading_date) {
      firstReadingOfMonth[month] = r;
    }
  });

  const sortedMonths = Object.keys(lastReadingOfMonth).sort();
  const monthlyData: Record<string, number> = {};
  sortedMonths.forEach((month, index) => {
    const currentReading = lastReadingOfMonth[month];
    const prevReading = index > 0 ? lastReadingOfMonth[sortedMonths[index - 1]] : null;
    let consumed: number;
    if (prevReading) {
      consumed = currentReading.reading_value - prevReading.reading_value;
    } else {
      const firstReading = firstReadingOfMonth[month];
      const baseline = firstReading?.previous_reading ?? 0;
      consumed = currentReading.reading_value - baseline;
    }
    monthlyData[month] = Math.max(0, consumed);
  });
  return monthlyData;
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Normal case
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 1: 正常情况（每天记录，无间隔）═══');
{
  const readings = [
    makeReading('2026-06-01', 100, null),
    makeReading('2026-06-02', 110, 100),
    makeReading('2026-06-03', 125, 110),
    makeReading('2026-06-04', 135, 125),
    makeReading('2026-06-05', 150, 135),
  ];

  const dailyData = calcDailyChartData(readings);
  assert(dailyData.length === 5, '5 days of data');
  assert(dailyData[0].dailyAvg === 0, 'First day dailyAvg = 0');
  assert(dailyData[1].dailyAvg === 10, 'Day 2: 10/1 = 10');
  assert(dailyData[4].dailyAvg === 15, 'Day 5: 15/1 = 15');

  const usageData = calcUsageChartData(readings);
  assert(approxEqual(usageData['2026-06'].dailyAvg, 10), 'June daily avg = 10');

  // Stats: first reading prev=null → baseline=0, total = 150-0 = 150
  const stats = calcStats(readings, '2026-06');
  assert(stats.totalConsumed === 150, 'Total consumed = 150 (from initial 0)', stats.totalConsumed, 150);

  const monthly = calcMonthlyComparison(readings);
  assert(monthly['2026-06'] === 150, 'Monthly June = 150', monthly['2026-06'], 150);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Gap in the middle
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 2: 中间隔了3天没记═══');
{
  const readings = [
    makeReading('2026-06-01', 100, null),
    makeReading('2026-06-05', 140, 100),
    makeReading('2026-06-06', 150, 140),
  ];

  const dailyData = calcDailyChartData(readings);
  assert(dailyData[1].totalConsumed === 40, 'Jun 5 consumed = 40');
  assert(dailyData[1].days === 4, 'Jun 5 days = 4');
  assert(dailyData[1].dailyAvg === 10, 'Jun 5 dailyAvg = 10');

  const usageData = calcUsageChartData(readings);
  assert(approxEqual(usageData['2026-06'].dailyAvg, 8.33), 'June daily avg ≈ 8.33');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Multiple readings on same day
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 3: 同一天记了两次═══');
{
  const readings = [
    makeReading('2026-06-01', 100, null),
    makeReading('2026-06-02', 110, 100, '08:00'),
    makeReading('2026-06-02', 115, 110, '20:00'),
    makeReading('2026-06-03', 125, 115),
  ];

  const dailyData = calcDailyChartData(readings);
  // first=08:00(prev=100), last=20:00(value=115), consumed=115-100=15
  assert(dailyData[1].totalConsumed === 15, 'Jun 2 consumed = 15 (115-100)');
  assert(dailyData[1].dailyAvg === 15, 'Jun 2 dailyAvg = 15');

  const monthly = calcMonthlyComparison(readings);
  // first reading prev=null → baseline=0, consumed = 125-0 = 125
  assert(monthly['2026-06'] === 125, 'Monthly June = 125', monthly['2026-06'], 125);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Month not ended
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 4: 当月没结束═══');
{
  const readings = [
    makeReading('2026-05-28', 1000, 980),
    makeReading('2026-05-31', 1030, 1000),
    makeReading('2026-06-01', 1040, 1030),
    makeReading('2026-06-05', 1080, 1040),
    makeReading('2026-06-13', 1150, 1080),
  ];

  const usageData = calcUsageChartData(readings);
  assert(usageData['2026-06'].days === 13, 'June days = 13');
  assert(approxEqual(usageData['2026-06'].dailyAvg, 8.46), 'June daily avg ≈ 8.46');

  const dailyData = calcDailyChartData(readings);
  const jun13 = dailyData.find(d => d.date === '2026-06-13');
  assert(jun13!.days === 8, 'Jun 13 days = 8');
  assert(approxEqual(jun13!.dailyAvg, 8.75), 'Jun 13 dailyAvg = 8.75');

  const stats = calcStats(readings, '2026-06');
  assert(stats.currentMonthConsumed === 120, 'Current month = 120');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Skipped an entire month
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 5: 隔了一个月没记═══');
{
  const readings = [
    makeReading('2026-04-15', 500, 480),
    makeReading('2026-04-30', 530, 500),
    makeReading('2026-06-01', 560, 530),
    makeReading('2026-06-15', 600, 560),
  ];

  const dailyData = calcDailyChartData(readings);
  const jun1 = dailyData.find(d => d.date === '2026-06-01');
  assert(jun1!.days === 32, 'Jun 1 days = 32');
  assert(approxEqual(jun1!.dailyAvg, 0.94), 'Jun 1 dailyAvg ≈ 0.94');

  const usageData = calcUsageChartData(readings);
  assert(approxEqual(usageData['2026-06'].dailyAvg, 2.67), 'June daily avg ≈ 2.67');

  const monthly = calcMonthlyComparison(readings);
  assert(monthly['2026-06'] === 70, 'Monthly June = 70');

  const stats = calcStats(readings, '2026-06');
  assert(stats.totalConsumed === 120, 'Total = 120');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 6: First reading
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 6: 第一条读数═══');
{
  const readings = [
    makeReading('2026-06-01', 100, null),
    makeReading('2026-06-02', 110, 100),
  ];

  assert(readings[0].units_consumed === 100, 'First reading consumed = 100');

  const dailyData = calcDailyChartData(readings);
  assert(dailyData[0].dailyAvg === 0, 'First day dailyAvg = 0');

  const monthly = calcMonthlyComparison(readings);
  assert(monthly['2026-06'] === 110, 'Monthly June = 110', monthly['2026-06'], 110);
}

// ═══════════════════════════════════════════════════════════════════
// TEST 7: Complex scenario
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 7: 复杂场景═══');
{
  const readings = [
    makeReading('2026-04-01', 1000, 980),
    makeReading('2026-04-02', 1010, 1000),
    makeReading('2026-04-03', 1025, 1010),
    makeReading('2026-05-01', 1060, 1025),
    makeReading('2026-05-31', 1120, 1060),
    makeReading('2026-06-01', 1130, 1120, '08:00'),
    makeReading('2026-06-01', 1132, 1130, '20:00'),
    makeReading('2026-06-10', 1200, 1132),
  ];

  const lastDay = lastReadingOfDay(readings);
  assert(lastDay['2026-06-01'].reading_value === 1132, 'Jun 1 picks 20:00 value=1132');

  const dailyData = calcDailyChartData(readings);
  const may1 = dailyData.find(d => d.date === '2026-05-01');
  assert(may1!.days === 28, 'May 1 days = 28');
  assert(approxEqual(may1!.dailyAvg, 1.25), 'May 1 dailyAvg = 1.25');

  const jun1 = dailyData.find(d => d.date === '2026-06-01');
  assert(jun1!.totalConsumed === 12, 'Jun 1 consumed = 12 (1132-1120)');

  const usageData = calcUsageChartData(readings);
  // April: start=Apr 1 (1000), end=Apr 3 (1025), days=3, consumed=25, dailyAvg=8.33
  assert(approxEqual(usageData['2026-04'].dailyAvg, 8.33), 'April daily avg = 8.33');
  // May: start=May 1 interpolated (1060), end=May 31 (1120), days=31, consumed=60, dailyAvg=1.94
  assert(approxEqual(usageData['2026-05'].dailyAvg, 1.94), 'May daily avg = 1.94');
  // June: start=Jun 1 interpolated (1132), end=Jun 10 (1200), days=10, consumed=68, dailyAvg=6.8
  assert(approxEqual(usageData['2026-06'].dailyAvg, 6.8), 'June daily avg = 6.8');

  const monthly = calcMonthlyComparison(readings);
  // April: first.prev=980, last=1025, consumed=45
  assert(monthly['2026-04'] === 45, 'April = 45');
  // May: prev=Apr last(1025), last=1120, consumed=95
  assert(monthly['2026-05'] === 95, 'May = 95');
  // June: prev=May last(1120), last=1200, consumed=80
  assert(monthly['2026-06'] === 80, 'June = 80');

  const stats = calcStats(readings, '2026-06');
  assert(stats.totalConsumed === 220, 'Total = 45+95+80 = 220');
  assert(stats.currentMonthConsumed === 80, 'Current month = 80');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 8: Cross-year
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 8: 跨年═══');
{
  const readings = [
    makeReading('2025-12-28', 5000, 4980),
    makeReading('2025-12-31', 5030, 5000),
    makeReading('2026-01-01', 5040, 5030),
    makeReading('2026-01-15', 5200, 5040),
  ];

  const monthly = calcMonthlyComparison(readings);
  assert(monthly['2025-12'] === 50, 'Dec = 50');
  assert(monthly['2026-01'] === 170, 'Jan = 170');

  const stats = calcStats(readings, '2026-01');
  assert(stats.totalConsumed === 220, 'Total = 220');

  // Usage chart: Dec start=null→first.prev=4980, end=Dec 31 (5030), days=31
  // consumed=50, dailyAvg=50/31=1.61
  const usageData = calcUsageChartData(readings);
  assert(approxEqual(usageData['2025-12'].dailyAvg, 1.61), 'Dec daily avg = 1.61');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 9: Same day multiple readings - total day consumption
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 9: 同一天多次记录 - 日用电量汇总═══');
{
  const readings = [
    makeReading('2026-06-01', 100, null),
    makeReading('2026-06-02', 110, 100, '08:00'),
    makeReading('2026-06-02', 120, 110, '14:00'),
    makeReading('2026-06-02', 130, 120, '22:00'),
    makeReading('2026-06-03', 145, 130),
  ];

  const dailyData = calcDailyChartData(readings);
  const jun2 = dailyData.find(d => d.date === '2026-06-02');
  // first=08:00(prev=100), last=22:00(value=130), consumed=130-100=30
  assert(jun2!.totalConsumed === 30, 'Jun 2 total = 30 (130-100)');
  assert(jun2!.dailyAvg === 30, 'Jun 2 dailyAvg = 30');
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`结果: ${passed} 通过, ${failed} 失败`);
console.log(`${'═'.repeat(60)}`);

if (failed > 0) {
  process.exit(1);
}
