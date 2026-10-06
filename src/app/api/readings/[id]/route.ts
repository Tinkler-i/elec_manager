import { NextRequest, NextResponse } from 'next/server';
import { deleteReading, findNextReading, findPreviousReading, getReadingById, updateReading } from '@/lib/db';
import { readJson } from '@/lib/read-json';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const reading = getReadingById(id);

    if (!reading) {
      return NextResponse.json({ error: '读数不存在' }, { status: 404 });
    }

    return NextResponse.json(reading);
  } catch (error) {
    console.error('获取读数失败:', error);
    return NextResponse.json({ error: '获取读数失败' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = await readJson<{
      reading_value?: number;
      reading_date?: string;
      reading_time?: string | null;
      notes?: string | null;
    }>(request);
    if (!parsed.ok) return parsed.response;
    const { reading_value, reading_date, reading_time, notes } = parsed.body;

    const oldReading = getReadingById(id);
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

    // 排除自己：否则「后一条」会查到自身
    const prevReading = findPreviousReading(reading_date, newTime, id);
    const nextReading = findNextReading(reading_date, newTime, id);

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

    const updatedReading = updateReading(id, {
      reading_value,
      reading_date,
      reading_time: newTime,
      notes: notes ?? null,
    });

    return NextResponse.json(updatedReading);
  } catch (error) {
    console.error('更新读数失败:', error);
    return NextResponse.json({ error: '更新读数失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!deleteReading(id)) {
      return NextResponse.json({ error: '读数不存在' }, { status: 404 });
    }

    return NextResponse.json({ message: '读数已删除' });
  } catch (error) {
    console.error('删除读数失败:', error);
    return NextResponse.json({ error: '删除读数失败' }, { status: 500 });
  }
}
