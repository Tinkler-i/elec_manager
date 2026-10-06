// Test script for all calculation logic across the system
// Run: npm test

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * 图表算法直接跑生产实现（`src/lib/chart-data.ts`），不在本文件里复制一份。
 *
 * 复制版的毛病是：把 `chart-data.ts` 改坏，这些用例不会红 —— 测试拦不住就等于没测。
 *
 * 为什么用动态 import 而不是静态 import：Node 的 ESM 要求说明符带扩展名，
 * 而 TS 在没开 `allowImportingTsExtensions` 时不允许 import 路径以 `.ts` 结尾。
 * 动态 import 的说明符是运行时字符串，两边限制都绕开了。
 */
const here = dirname(fileURLToPath(import.meta.url));
// 说明符是运行时字符串，TS 推不出类型，所以用类型位置的 import() 标注一下 ——
// 它在类型位置，编译后不存在，不影响运行时。
const chartData: typeof import('../src/lib/chart-data') = await import(
  `${pathToFileURL(join(here, '..', 'src', 'lib', 'chart-data.ts')).href}`
);
const { dailyUsage, lastReadingOfDay, monthlyConsumption, monthlyDailyAverage, annualSeries, annualChartRows } =
  chartData;

/** 图表用例不校验电费，单价取默认值即可 */
const RATE = 0.56;

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
// 图表算法：不再复制实现
//
// 原来这里有 calcDailyChartData / lastReadingOfDay / interpolateAtDate /
// calcUsageChartData 四份副本，对应 src/lib/chart-data.ts 里的
// dailyUsage / lastReadingOfDay / monthlyDailyAverage。现在直接用真代码，
// 副本已删除 —— 改坏 chart-data.ts，下面的用例必须变红。
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
// 统计：保留一份副本，但它只当「期望值 oracle」
//
// 生产实现是 src/lib/db.ts 的 getStats()，要开 SQLite，而且 currentMonth 取自
// 真实当月 —— 没法当纯函数 import 进来（TEST 4 / TEST 7 断言的是 2026-06，
// 直接跑 getStats() 必挂）。
//
// 所以这里留一份 oracle，同时在文件末尾加了一条交叉校验：用临时 SQLite 造同一份
// 数据跑真实的 getStats()，断言两者结果一致。这样副本被钉在生产实现上 ——
// db.getStats() 改坏，交叉校验就红。
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
// 月度对比：不再复制实现
//
// 原来的 calcMonthlyComparison 副本对应 src/lib/chart-data.ts 的
// monthlyConsumption，已删除，直接用真代码。
// ═══════════════════════════════════════════════════════════════════


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

  const dailyData = dailyUsage(readings, RATE);
  assert(dailyData.length === 5, '5 days of data');
  assert(dailyData[0].dailyAvg === 0, 'First day dailyAvg = 0');
  assert(dailyData[1].dailyAvg === 10, 'Day 2: 10/1 = 10');
  assert(dailyData[4].dailyAvg === 15, 'Day 5: 15/1 = 15');

  // 生产实现按月份返回数组，这里转回「月份 → 该项」的字典，断言语义不变
  const usageData = Object.fromEntries(
    monthlyDailyAverage(readings).map(m => [m.month, m] as const),
  );
  assert(approxEqual(usageData['2026-06'].dailyAvg, 10), 'June daily avg = 10');

  // Stats: first reading prev=null → baseline=0, total = 150-0 = 150
  const stats = calcStats(readings, '2026-06');
  assert(stats.totalConsumed === 150, 'Total consumed = 150 (from initial 0)', stats.totalConsumed, 150);

  const monthly = Object.fromEntries(
    monthlyConsumption(readings).map(m => [m.month, m.consumed] as const),
  );
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

  const dailyData = dailyUsage(readings, RATE);
  assert(dailyData[1].totalConsumed === 40, 'Jun 5 consumed = 40');
  assert(dailyData[1].days === 4, 'Jun 5 days = 4');
  assert(dailyData[1].dailyAvg === 10, 'Jun 5 dailyAvg = 10');

  // 生产实现按月份返回数组，这里转回「月份 → 该项」的字典，断言语义不变
  const usageData = Object.fromEntries(
    monthlyDailyAverage(readings).map(m => [m.month, m] as const),
  );
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

  const dailyData = dailyUsage(readings, RATE);
  // first=08:00(prev=100), last=20:00(value=115), consumed=115-100=15
  assert(dailyData[1].totalConsumed === 15, 'Jun 2 consumed = 15 (115-100)');
  assert(dailyData[1].dailyAvg === 15, 'Jun 2 dailyAvg = 15');

  const monthly = Object.fromEntries(
    monthlyConsumption(readings).map(m => [m.month, m.consumed] as const),
  );
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

  // 生产实现按月份返回数组，这里转回「月份 → 该项」的字典，断言语义不变
  const usageData = Object.fromEntries(
    monthlyDailyAverage(readings).map(m => [m.month, m] as const),
  );
  assert(usageData['2026-06'].days === 13, 'June days = 13');
  assert(approxEqual(usageData['2026-06'].dailyAvg, 8.46), 'June daily avg ≈ 8.46');

  const dailyData = dailyUsage(readings, RATE);
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

  const dailyData = dailyUsage(readings, RATE);
  const jun1 = dailyData.find(d => d.date === '2026-06-01');
  assert(jun1!.days === 32, 'Jun 1 days = 32');
  assert(approxEqual(jun1!.dailyAvg, 0.94), 'Jun 1 dailyAvg ≈ 0.94');

  // 生产实现按月份返回数组，这里转回「月份 → 该项」的字典，断言语义不变
  const usageData = Object.fromEntries(
    monthlyDailyAverage(readings).map(m => [m.month, m] as const),
  );
  assert(approxEqual(usageData['2026-06'].dailyAvg, 2.67), 'June daily avg ≈ 2.67');

  const monthly = Object.fromEntries(
    monthlyConsumption(readings).map(m => [m.month, m.consumed] as const),
  );
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

  // 注意：这条断言的是 makeReading 这个夹具函数自己算得对不对（生产里
  // units_consumed 是 SQLite 的生成列），它不覆盖任何生产代码。保留它只是为了
  // 不动原有 45 条的语义与数量，别把它当成有效覆盖。
  assert(readings[0].units_consumed === 100, 'First reading consumed = 100');

  const dailyData = dailyUsage(readings, RATE);
  assert(dailyData[0].dailyAvg === 0, 'First day dailyAvg = 0');

  const monthly = Object.fromEntries(
    monthlyConsumption(readings).map(m => [m.month, m.consumed] as const),
  );
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

  // 生产实现返回数组，转回「日期 → 读数」的字典，断言语义不变
  const lastDay = Object.fromEntries(
    lastReadingOfDay(readings).map(r => [r.reading_date, r] as const),
  );
  assert(lastDay['2026-06-01'].reading_value === 1132, 'Jun 1 picks 20:00 value=1132');

  const dailyData = dailyUsage(readings, RATE);
  const may1 = dailyData.find(d => d.date === '2026-05-01');
  assert(may1!.days === 28, 'May 1 days = 28');
  assert(approxEqual(may1!.dailyAvg, 1.25), 'May 1 dailyAvg = 1.25');

  const jun1 = dailyData.find(d => d.date === '2026-06-01');
  assert(jun1!.totalConsumed === 12, 'Jun 1 consumed = 12 (1132-1120)');

  // 生产实现按月份返回数组，这里转回「月份 → 该项」的字典，断言语义不变
  const usageData = Object.fromEntries(
    monthlyDailyAverage(readings).map(m => [m.month, m] as const),
  );
  // April: start=Apr 1 (1000), end=Apr 3 (1025), days=3, consumed=25, dailyAvg=8.33
  assert(approxEqual(usageData['2026-04'].dailyAvg, 8.33), 'April daily avg = 8.33');
  // May: start=May 1 interpolated (1060), end=May 31 (1120), days=31, consumed=60, dailyAvg=1.94
  assert(approxEqual(usageData['2026-05'].dailyAvg, 1.94), 'May daily avg = 1.94');
  // June: start=Jun 1 interpolated (1132), end=Jun 10 (1200), days=10, consumed=68, dailyAvg=6.8
  assert(approxEqual(usageData['2026-06'].dailyAvg, 6.8), 'June daily avg = 6.8');

  const monthly = Object.fromEntries(
    monthlyConsumption(readings).map(m => [m.month, m.consumed] as const),
  );
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

  const monthly = Object.fromEntries(
    monthlyConsumption(readings).map(m => [m.month, m.consumed] as const),
  );
  assert(monthly['2025-12'] === 50, 'Dec = 50');
  assert(monthly['2026-01'] === 170, 'Jan = 170');

  const stats = calcStats(readings, '2026-01');
  assert(stats.totalConsumed === 220, 'Total = 220');

  // Usage chart: Dec start=null→first.prev=4980, end=Dec 31 (5030), days=31
  // consumed=50, dailyAvg=50/31=1.61
  // 生产实现按月份返回数组，这里转回「月份 → 该项」的字典，断言语义不变
  const usageData = Object.fromEntries(
    monthlyDailyAverage(readings).map(m => [m.month, m] as const),
  );
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

  const dailyData = dailyUsage(readings, RATE);
  const jun2 = dailyData.find(d => d.date === '2026-06-02');
  // first=08:00(prev=100), last=22:00(value=130), consumed=130-100=30
  assert(jun2!.totalConsumed === 30, 'Jun 2 total = 30 (130-100)');
  assert(jun2!.dailyAvg === 30, 'Jun 2 dailyAvg = 30');
}

// ═══════════════════════════════════════════════════════════════════
// TEST 14: 年度分析（annualSeries / annualChartRows）
//
// 原来这两条生产函数一条用例都没有 —— 改坏它们不会有任何测试变红。补上，
// 让「改坏 chart-data.ts 里任意一个算法都会红」这条成立。
// ═══════════════════════════════════════════════════════════════════
console.log('\n═══ TEST 14: 年度分析（annualSeries / annualChartRows）═══');
{
  const readings = [
    makeReading('2025-12-28', 5000, 4980),
    makeReading('2025-12-31', 5030, 5000),
    makeReading('2026-01-01', 5040, 5030),
    makeReading('2026-01-15', 5200, 5040),
  ];

  const series = annualSeries(readings);
  assert(
    series.years.map(y => y.year).join(',') === '2025,2026',
    '年度: 两年各一条线',
    series.years.map(y => y.year).join(','),
    '2025,2026',
  );
  assert(series.months.join(',') === '01,12', '年度: 横轴取出现过的月份', series.months.join(','), '01,12');

  const rows = annualChartRows(series);
  // 没抄表的月份必须是 null，不能是 0 —— 断线和不用电在图上要能区分
  assert(rows[0]['2025'] === null, '年度: 没抄表的月份是 null（不是 0）', rows[0]['2025'], null);
  assert(rows[0]['2026'] === 170, '年度: 2026-01 = 170', rows[0]['2026'], 170);
  assert(rows[1]['2025'] === 50, '年度: 2025-12 = 50', rows[1]['2025'], 50);
}

// ═══════════════════════════════════════════════════════════════════
// 回归测试（A1 / A2 / A3）—— 直接调用 src/lib 里的生产代码
//
// 与上面的图表用例不同：这些不复制实现，而是 import 真代码。故意把 src/lib
// 里的实现改坏，这里必须变红；改不红就说明测试没测到东西。
//
// 为什么用动态 import + 查询串：BACKUP_DIR / DB_PATH 是模块加载时读环境变量算出来的，
// 要分别验证「设了 / 没设」两条分支，就得让模块用不同 URL 重新求值一次。
// A5（冷启动会话）需要起进程，单测覆盖不了，另见 scripts/test-cold-start.mjs。
// ═══════════════════════════════════════════════════════════════════

async function runRegressionTests() {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { pathToFileURL } = await import('node:url');

  const libUrl = (rel: string, bust: string) =>
    `${pathToFileURL(path.join(here, '..', 'src', 'lib', rel)).href}?${bust}`;

  // ── A1：敏感设置不外发 ──────────────────────────────────────────
  console.log('\n═══ TEST 10: A1 敏感设置不外发（toPublicSettings）═══');
  {
    const { toPublicSettings, isSensitiveSettingKey } = await import(libUrl('settings-keys.ts', 'a1'));
    const out = toPublicSettings([
      { key: 'rate_per_kwh', value: '0.56' },
      { key: 'auth_password', value: '$2b$10$abcdefghijklmnopqrstuv' },
      { key: 'mcp_key_hash', value: 'deadbeef' },
      { key: 'mcp_key_created_at', value: '2026-10-06T00:00:00.000Z' },
      { key: 'mcp_key_last_used_at', value: '2026-10-06T01:00:00.000Z' },
      { key: 'initial_reading', value: '0' },
    ]);
    assert(!('auth_password' in out), 'A1: auth_password 被过滤');
    assert(!('mcp_key_hash' in out), 'A1: mcp_key_hash 被过滤');
    assert(!('mcp_key_created_at' in out), 'A1: mcp_key_created_at 被过滤');
    assert(!('mcp_key_last_used_at' in out), 'A1: mcp_key_last_used_at 被过滤');
    assert(out.rate_per_kwh === '0.56', 'A1: rate_per_kwh 保留', out.rate_per_kwh, '0.56');
    assert(out.initial_reading === '0', 'A1: initial_reading 保留', out.initial_reading, '0');
    assert(Object.keys(out).length === 2, 'A1: 只返回 2 个非敏感项', Object.keys(out).length, 2);
    assert(isSensitiveSettingKey('auth_password'), 'A1: isSensitiveSettingKey(auth_password)=true');
    assert(!isSensitiveSettingKey('rate_per_kwh'), 'A1: isSensitiveSettingKey(rate_per_kwh)=false');
  }

  // ── A2：备份目录 ────────────────────────────────────────────────
  console.log('\n═══ TEST 11: A2 备份目录（BACKUP_DIR）═══');
  {
    const savedEnv = {
      ELEC_DB_PATH: process.env.ELEC_DB_PATH,
      ELEC_DATA_DIR: process.env.ELEC_DATA_DIR,
      ELEC_BACKUP_DIR: process.env.ELEC_BACKUP_DIR,
    };
    const base = path.join(os.tmpdir(), 'elec-a2-probe');
    try {
      process.env.ELEC_DB_PATH = path.join(base, 'data', 'elec.db');
      delete process.env.ELEC_DATA_DIR;

      process.env.ELEC_BACKUP_DIR = path.join(base, 'explicit-backups');
      const explicit = await import(libUrl('db.ts', 'a2-explicit'));
      assert(
        explicit.BACKUP_DIR === process.env.ELEC_BACKUP_DIR,
        'A2: 设了 ELEC_BACKUP_DIR 就用它（飞牛升级保留的那个目录）',
        explicit.BACKUP_DIR,
        process.env.ELEC_BACKUP_DIR,
      );

      delete process.env.ELEC_BACKUP_DIR;
      const fallback = await import(libUrl('db.ts', 'a2-fallback'));
      const expectedFallback = path.join(path.dirname(process.env.ELEC_DB_PATH), 'backups');
      assert(
        fallback.BACKUP_DIR === expectedFallback,
        'A2: 未设时回退到 dirname(ELEC_DB_PATH)/backups',
        fallback.BACKUP_DIR,
        expectedFallback,
      );

      process.env.ELEC_DATA_DIR = path.join(base, 'custom-data');
      const withDataDir = await import(libUrl('db.ts', 'a2-datadir'));
      const expectedDataDir = path.join(process.env.ELEC_DATA_DIR, 'backups');
      assert(
        withDataDir.BACKUP_DIR === expectedDataDir,
        'A2: 设了 ELEC_DATA_DIR 时跟它走',
        withDataDir.BACKUP_DIR,
        expectedDataDir,
      );
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  // ── A3：同一天两笔 ──────────────────────────────────────────────
  console.log('\n═══ TEST 12: A3 同一天两笔（findPreviousReading / findNextReading）═══');
  {
    const savedDbPath = process.env.ELEC_DB_PATH;
    // 固定目录：better-sqlite3 的连接在测试进程退出前不会关闭，Windows 上删不掉，
    // 所以每轮先清掉上一轮留下的，避免系统临时目录越积越多。
    const tmpDir = path.join(os.tmpdir(), 'elec-a3-test');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      process.env.ELEC_DB_PATH = path.join(tmpDir, 'elec.db');
      const db = await import(libUrl('db.ts', `a3-${Date.now()}`));

      const first = db.createReading({ reading_value: 1000, reading_date: '2026-09-15', reading_time: '08:00' });
      assert(first.previous_reading === 0, 'A3: 第一笔用初始读数 0', first.previous_reading, 0);

      const second = db.createReading({ reading_value: 1010, reading_date: '2026-09-15', reading_time: '18:00' });
      assert(second.previous_reading === 1000, 'A3: 同日第二笔取当天更早那笔', second.previous_reading, 1000);
      assert(second.units_consumed === 10, 'A3: 同日第二笔用量 = 10（不是 1010）', second.units_consumed, 10);

      const prev = db.findPreviousReading('2026-09-15', '18:00');
      assert(prev?.reading_value === 1000, 'A3: findPreviousReading 返回当天更早那笔', prev?.reading_value, 1000);

      const next = db.findNextReading('2026-09-15', '08:00');
      assert(next?.reading_value === 1010, 'A3: findNextReading 返回当天更晚那笔', next?.reading_value, 1010);

      assert(db.findPreviousReading('2026-09-15', '08:00') === undefined, 'A3: 当天最早那笔没有前一条');

      const excluded = db.findPreviousReading('2026-09-15', '18:00', second.id);
      assert(excluded?.reading_value === 1000, 'A3: excludeId 排除自己后仍找到 1000', excluded?.reading_value, 1000);
    } finally {
      if (savedDbPath === undefined) delete process.env.ELEC_DB_PATH;
      else process.env.ELEC_DB_PATH = savedDbPath;
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Windows 上 sqlite 连接未关，临时文件可能删不掉；留在系统临时目录里，不影响测试结论
      }
    }
  }

  // ── 交叉校验：本地 oracle vs 生产 db.getStats() ────────────────────
  // calcStats 是副本，只当「期望值 oracle」。这一段把它钉在生产实现上：用临时
  // SQLite 造同一份数据，跑真实的 getStats()，两者必须一致 —— db.getStats() 改坏，
  // 这里就红，副本不再是脱钩的。
  //
  // getStats() 的 currentMonth 取自真实当月，所以数据按「真实当月 + 上个月」构造，
  // 这样 currentMonthConsumed 非零、可比较。
  console.log('\n═══ TEST 13: 交叉校验 calcStats oracle vs db.getStats() ═══');
  {
    const savedDbPath = process.env.ELEC_DB_PATH;
    const tmpDir = path.join(os.tmpdir(), 'elec-stats-crosscheck');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      process.env.ELEC_DB_PATH = path.join(tmpDir, 'elec.db');
      const db = await import(libUrl('db.ts', `stats-${Date.now()}`));

      const now = new Date();
      const ymd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const lastMonthDay = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 15));
      const thisMonthDay = ymd(new Date(now.getFullYear(), now.getMonth(), 15));
      const currentMonth = thisMonthDay.substring(0, 7);

      // 第一笔的 previous_reading 由 initial_reading 设置推导，先把它对齐到夹具的 980，
      // 否则写进库的数据和 oracle 用的夹具不是同一份。
      db.getDb().prepare('UPDATE settings SET value = ? WHERE key = ?').run('980', 'initial_reading');
      db.invalidateSettingsCache();

      const fixtures = [
        makeReading(lastMonthDay, 1000, 980),
        makeReading(thisMonthDay, 1100, 1000),
      ];
      for (const f of fixtures) {
        db.createReading({
          reading_value: f.reading_value,
          reading_date: f.reading_date,
          reading_time: null,
          notes: null,
        });
      }

      const oracle = calcStats(fixtures, currentMonth);
      const prod = db.getStats();
      const rate = db.getRatePerKwh();
      const expected = {
        totalReadings: fixtures.length,
        totalConsumed: oracle.totalConsumed,
        totalAmount: oracle.totalConsumed * rate,
        currentMonthConsumed: oracle.currentMonthConsumed,
        currentMonthAmount: oracle.currentMonthConsumed * rate,
      };
      const same =
        prod.totalReadings === expected.totalReadings &&
        approxEqual(prod.totalConsumed, expected.totalConsumed) &&
        approxEqual(prod.totalAmount, expected.totalAmount) &&
        approxEqual(prod.currentMonthConsumed, expected.currentMonthConsumed) &&
        approxEqual(prod.currentMonthAmount, expected.currentMonthAmount);

      assert(
        same,
        '交叉校验: db.getStats() 与 calcStats oracle 逐字段一致',
        JSON.stringify(prod),
        JSON.stringify(expected),
      );
    } finally {
      if (savedDbPath === undefined) delete process.env.ELEC_DB_PATH;
      else process.env.ELEC_DB_PATH = savedDbPath;
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Windows 上 sqlite 连接未关，临时文件可能删不掉；不影响测试结论
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════
runRegressionTests()
  .catch((e: unknown) => {
    failed++;
    console.log(`  ✗ 回归测试执行失败: ${e instanceof Error ? e.message : String(e)}`);
  })
  .then(() => {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`结果: ${passed} 通过, ${failed} 失败`);
    console.log(`${'═'.repeat(60)}`);

    if (failed > 0) {
      process.exit(1);
    }
  });
