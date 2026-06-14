import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { Reading } from '@/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const { id } = await params;
    const reading = db.prepare('SELECT * FROM readings WHERE id = ?').get(id) as Reading | undefined;

    if (!reading) {
      return NextResponse.json({ error: '读数不存在' }, { status: 404 });
    }

    return NextResponse.json(reading);
  } catch (error) {
    return NextResponse.json({ error: '获取读数失败' }, { status: 500 });
  }
}

function updateNextReadingPrevious(db: ReturnType<typeof getDb>, currentReading: Reading, newValue: number) {
  const nextReading = db.prepare(
      'SELECT id, previous_reading FROM readings WHERE reading_date > ? OR (reading_date = ? AND reading_time > ?) ORDER BY reading_date ASC, reading_time ASC LIMIT 1'
    ).get(currentReading.reading_date, currentReading.reading_date, currentReading.reading_time ?? '') as { id: string; previous_reading: number } | undefined;

  if (nextReading && nextReading.previous_reading === currentReading.reading_value) {
    db.prepare('UPDATE readings SET previous_reading = ? WHERE id = ?').run(newValue, nextReading.id);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const { id } = await params;
    const body = await request.json();
    const { reading_value, reading_date, reading_time, notes } = body;

    const oldReading = db.prepare('SELECT * FROM readings WHERE id = ?').get(id) as Reading | undefined;
    if (!oldReading) {
      return NextResponse.json({ error: '读数不存在' }, { status: 404 });
    }

    // 输入验证
    if (typeof reading_value !== 'number' || !isFinite(reading_value) || reading_value < 0) {
      return NextResponse.json({ error: '读数值必须是有效的非负数' }, { status: 400 });
    }
    if (typeof reading_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reading_date)) {
      return NextResponse.json({ error: '日期格式不正确，应为 YYYY-MM-DD' }, { status: 400 });
    }
    if (reading_time !== undefined && reading_time !== null && reading_time !== '') {
      if (typeof reading_time !== 'string' || !/^\d{2}:\d{2}$/.test(reading_time)) {
        return NextResponse.json({ error: '时间格式不正确，应为 HH:MM' }, { status: 400 });
      }
    }

    const newTime = reading_time !== undefined ? (reading_time || null) : oldReading.reading_time;

    const prevReading = db.prepare(
      `SELECT reading_value FROM readings WHERE (reading_date < ? OR (reading_date = ? AND COALESCE(reading_time, '') < COALESCE(?, ''))) AND id != ? ORDER BY reading_date DESC, reading_time DESC LIMIT 1`
    ).get(reading_date, reading_date, newTime, id) as { reading_value: number } | undefined;

    const nextReading = db.prepare(
      `SELECT reading_value FROM readings WHERE (reading_date > ? OR (reading_date = ? AND COALESCE(reading_time, '') > COALESCE(?, ''))) AND id != ? ORDER BY reading_date ASC, reading_time ASC LIMIT 1`
    ).get(reading_date, reading_date, newTime, id) as { reading_value: number } | undefined;

    if (prevReading && reading_value < prevReading.reading_value) {
      return NextResponse.json(
        { error: `读数不能小于前一次读数 (${prevReading.reading_value})` },
        { status: 400 }
      );
    }

    if (nextReading && reading_value > nextReading.reading_value) {
      return NextResponse.json(
        { error: `读数不能大于后一次读数 (${nextReading.reading_value})` },
        { status: 400 }
      );
    }

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE readings
        SET reading_value = ?, reading_date = ?, reading_time = ?, notes = ?
        WHERE id = ?
      `).run(reading_value, reading_date, newTime, notes, id);

      updateNextReadingPrevious(db, oldReading, reading_value);
    });

    transaction();

    const updatedReading = db.prepare('SELECT * FROM readings WHERE id = ?').get(id);

    return NextResponse.json(updatedReading);
  } catch (error) {
    return NextResponse.json({ error: '更新读数失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const { id } = await params;

    const oldReading = db.prepare('SELECT * FROM readings WHERE id = ?').get(id) as Reading | undefined;
    if (!oldReading) {
      return NextResponse.json({ error: '读数不存在' }, { status: 404 });
    }

    const prevReading = db.prepare(
      `SELECT reading_value FROM readings WHERE (reading_date < ? OR (reading_date = ? AND COALESCE(reading_time, '') < COALESCE(?, ''))) ORDER BY reading_date DESC, reading_time DESC LIMIT 1`
    ).get(oldReading.reading_date, oldReading.reading_date, oldReading.reading_time ?? '') as { reading_value: number } | undefined;

    const newPreviousReading = prevReading?.reading_value ?? null;

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM readings WHERE id = ?').run(id);

      db.prepare(`
        UPDATE readings SET previous_reading = ?
        WHERE (reading_date > ? OR (reading_date = ? AND COALESCE(reading_time, '') > COALESCE(?, '')))
        AND previous_reading = ?
      `).run(newPreviousReading, oldReading.reading_date, oldReading.reading_date, oldReading.reading_time ?? '', oldReading.reading_value);
    });

    transaction();

    return NextResponse.json({ message: '读数已删除' });
  } catch (error) {
    return NextResponse.json({ error: '删除读数失败' }, { status: 500 });
  }
}
