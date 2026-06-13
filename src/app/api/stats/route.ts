import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();

    const totalReadings = (db.prepare('SELECT COUNT(*) as count FROM readings').get() as { count: number }).count;

    const totalConsumed = (db.prepare('SELECT COALESCE(SUM(units_consumed), 0) as total FROM readings').get() as { total: number }).total;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const currentMonthConsumed = (db.prepare(`
      SELECT COALESCE(SUM(units_consumed), 0) as total FROM readings
      WHERE reading_date LIKE ? || '%'
    `).get(currentMonth) as { total: number }).total;

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
