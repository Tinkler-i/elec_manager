import { NextRequest, NextResponse } from 'next/server';
import { createReading, findNextReading, findPreviousReading, getReadings } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start') ?? undefined;
    const end = searchParams.get('end') ?? undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam) : undefined;

    return NextResponse.json(getReadings({ start, end, limit }));
  } catch (error) {
    return NextResponse.json({ error: '获取读数失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { reading_value, reading_date, reading_time = null, notes, source = 'manual', created_by = 'user' } = body;

    // 输入验证
    if (typeof reading_value !== 'number' || !isFinite(reading_value) || reading_value < 0) {
      return NextResponse.json({ error: '读数值必须是有效的非负数' }, { status: 400 });
    }
    if (typeof reading_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reading_date)) {
      return NextResponse.json({ error: '日期格式不正确，应为 YYYY-MM-DD' }, { status: 400 });
    }
    if (reading_time !== null && reading_time !== undefined && reading_time !== '') {
      if (typeof reading_time !== 'string' || !/^\d{2}:\d{2}$/.test(reading_time)) {
        return NextResponse.json({ error: '时间格式不正确，应为 HH:MM' }, { status: 400 });
      }
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

    // 同一天的多笔按 reading_time 排先后，口径见 db.ts 的 findAdjacentReading
    const time = reading_time || null;
    const prevReading = findPreviousReading(reading_date, time);
    const nextReading = findNextReading(reading_date, time);

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

    const newReading = createReading({
      reading_value,
      reading_date,
      reading_time: time,
      notes,
      source,
      created_by,
    });

    return NextResponse.json(newReading, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: '创建读数失败' }, { status: 500 });
  }
}
