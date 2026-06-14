import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();

    const totalReadings = (db.prepare('SELECT COUNT(*) as count FROM readings').get() as { count: number }).count;

    // Get all readings and calculate accurate consumption based on month boundaries
    const readings = db.prepare('SELECT id, reading_value, reading_date, previous_reading FROM readings ORDER BY reading_date ASC').all() as Array<{ id: string; reading_value: number; reading_date: string; previous_reading: number | null }>;

    let totalConsumed = 0;
    let currentMonthConsumed = 0;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (readings.length > 0) {
      // Group readings by month and get the last reading of each month
      const lastReadingOfMonth: Record<string, typeof readings[0]> = {};
      readings.forEach(r => {
        const month = r.reading_date.substring(0, 7);
        if (!lastReadingOfMonth[month] || r.reading_date > lastReadingOfMonth[month].reading_date) {
          lastReadingOfMonth[month] = r;
        }
      });

      const sortedMonths = Object.keys(lastReadingOfMonth).sort();

      // Get the first reading of each month for baseline calculation
      const firstReadingOfMonth: Record<string, typeof readings[0]> = {};
      readings.forEach(r => {
        const month = r.reading_date.substring(0, 7);
        if (!firstReadingOfMonth[month] || r.reading_date < firstReadingOfMonth[month].reading_date) {
          firstReadingOfMonth[month] = r;
        }
      });

      // Calculate total and current month consumption based on month boundaries
      sortedMonths.forEach((month, index) => {
        const currentReading = lastReadingOfMonth[month];
        const prevReading = index > 0 ? lastReadingOfMonth[sortedMonths[index - 1]] : null;

        let monthConsumed: number;
        if (prevReading) {
          monthConsumed = currentReading.reading_value - prevReading.reading_value;
        } else {
          // First month: use the first reading's previous_reading as baseline
          const firstReading = firstReadingOfMonth[month];
          const baseline = firstReading?.previous_reading ?? 0;
          monthConsumed = currentReading.reading_value - baseline;
        }

        totalConsumed += Math.max(0, monthConsumed);

        if (month === currentMonth) {
          currentMonthConsumed = Math.max(0, monthConsumed);
        }
      });
    }

    const rateSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('rate_per_kwh') as { value: string } | undefined;
    const rate = rateSetting ? parseFloat(rateSetting.value) : 0.56;
    const currentMonthAmount = currentMonthConsumed * rate;
    const totalAmount = totalConsumed * rate;

    return NextResponse.json({
      totalReadings,
      totalConsumed,
      totalAmount,
      currentMonthConsumed,
      currentMonthAmount
    });
  } catch (error) {
    return NextResponse.json({ error: '获取统计数据失败' }, { status: 500 });
  }
}
