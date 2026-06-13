import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { Reading } from '@/types';

export async function POST() {
  try {
    const db = getDb();

    const initialSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('initial_reading') as { value: string } | undefined;
    const initialReading = initialSetting ? parseFloat(initialSetting.value) : 0;

    const allReadings = db.prepare('SELECT id, reading_value, reading_date FROM readings ORDER BY reading_date ASC').all() as Reading[];

    if (allReadings.length === 0) {
      return NextResponse.json({ message: '没有读数记录需要重算' });
    }

    const transaction = db.transaction(() => {
      for (let i = 0; i < allReadings.length; i++) {
        const current = allReadings[i];
        const prevReading = i > 0 ? allReadings[i - 1].reading_value : null;
        const newPreviousReading = i === 0 ? initialReading : prevReading;

        db.prepare('UPDATE readings SET previous_reading = ? WHERE id = ?').run(newPreviousReading, current.id);
      }
    });

    transaction();

    return NextResponse.json({
      message: `已重新计算 ${allReadings.length} 条读数`,
      initialReading
    });
  } catch (error) {
    return NextResponse.json({ error: '重算失败' }, { status: 500 });
  }
}
