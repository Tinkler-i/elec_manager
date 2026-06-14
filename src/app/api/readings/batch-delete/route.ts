import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { Reading } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '请提供要删除的读数 ID 列表' }, { status: 400 });
    }

    const readings = db.prepare(`SELECT * FROM readings WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Reading[];

    if (readings.length === 0) {
      return NextResponse.json({ error: '未找到要删除的读数' }, { status: 404 });
    }

    const sorted = readings.sort((a, b) =>
      a.reading_date.localeCompare(b.reading_date) || (a.reading_time ?? '').localeCompare(b.reading_time ?? '')
    );

    const transaction = db.transaction(() => {
      for (const reading of sorted) {
        const prevReading = db.prepare(
          `SELECT reading_value FROM readings WHERE (reading_date < ? OR (reading_date = ? AND COALESCE(reading_time, '') < COALESCE(?, ''))) ORDER BY reading_date DESC, reading_time DESC LIMIT 1`
        ).get(reading.reading_date, reading.reading_date, reading.reading_time ?? '') as { reading_value: number } | undefined;

        const newPreviousReading = prevReading?.reading_value ?? null;

        db.prepare('DELETE FROM readings WHERE id = ?').run(reading.id);

        db.prepare(`
          UPDATE readings SET previous_reading = ?
          WHERE (reading_date > ? OR (reading_date = ? AND COALESCE(reading_time, '') > COALESCE(?, '')))
          AND previous_reading = ?
        `).run(newPreviousReading, reading.reading_date, reading.reading_date, reading.reading_time ?? '', reading.reading_value);
      }
    });

    transaction();

    return NextResponse.json({ deleted: readings.length });
  } catch (error) {
    return NextResponse.json({ error: '批量删除失败' }, { status: 500 });
  }
}
