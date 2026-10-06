import { NextResponse } from 'next/server';
import { recalculatePreviousReadings } from '@/lib/db';

export async function POST() {
  try {
    const { count, initialReading } = recalculatePreviousReadings();

    if (count === 0) {
      return NextResponse.json({ message: '没有读数记录需要重算' });
    }

    return NextResponse.json({
      message: `已重新计算 ${count} 条读数`,
      initialReading
    });
  } catch (error) {
    console.error('重算失败:', error);
    return NextResponse.json({ error: '重算失败' }, { status: 500 });
  }
}
