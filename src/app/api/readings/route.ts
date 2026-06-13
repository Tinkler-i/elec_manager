import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { Reading } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const limit = searchParams.get('limit');

    let query = 'SELECT * FROM readings WHERE 1=1';
    const params: unknown[] = [];

    if (startDate) {
      query += ' AND reading_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND reading_date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY reading_date DESC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(parseInt(limit));
    }

    const readings = db.prepare(query).all(...params) as Reading[];
    return NextResponse.json(readings);
  } catch (error) {
    return NextResponse.json({ error: '获取读数失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { reading_value, reading_date, notes, source = 'manual', created_by = 'user' } = body;

    // 输入验证
    if (typeof reading_value !== 'number' || !isFinite(reading_value) || reading_value < 0) {
      return NextResponse.json({ error: '读数值必须是有效的非负数' }, { status: 400 });
    }
    if (typeof reading_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reading_date)) {
      return NextResponse.json({ error: '日期格式不正确，应为 YYYY-MM-DD' }, { status: 400 });
    }
    if (notes !== undefined && notes !== null && typeof notes !== 'string') {
      return NextResponse.json({ error: '备注必须是字符串' }, { status: 400 });
    }
    if (typeof notes === 'string' && notes.length > 500) {
      return NextResponse.json({ error: '备注过长' }, { status: 400 });
    }
    const validSources = ['manual', 'mcp', 'import'];
    if (!validSources.includes(source)) {
      return NextResponse.json({ error: '无效的 source 值' }, { status: 400 });
    }

    const prevReading = db.prepare(
      'SELECT reading_value FROM readings WHERE reading_date < ? ORDER BY reading_date DESC LIMIT 1'
    ).get(reading_date) as { reading_value: number } | undefined;

    const nextReading = db.prepare(
      'SELECT reading_value FROM readings WHERE reading_date > ? ORDER BY reading_date ASC LIMIT 1'
    ).get(reading_date) as { reading_value: number } | undefined;

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

    let previous_reading = prevReading?.reading_value ?? null;

    if (!prevReading) {
      const initialSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('initial_reading') as { value: string } | undefined;
      previous_reading = initialSetting ? parseFloat(initialSetting.value) : null;
    }

    const id = generateId();
    db.prepare(`
      INSERT INTO readings (id, reading_value, reading_date, previous_reading, notes, source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, reading_value, reading_date, previous_reading, notes, source, created_by);

    const newReading = db.prepare('SELECT * FROM readings WHERE id = ?').get(id);

    return NextResponse.json(newReading, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: '创建读数失败' }, { status: 500 });
  }
}
