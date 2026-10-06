import { NextRequest, NextResponse } from 'next/server';
import { deleteReadings } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '请提供要删除的读数 ID 列表' }, { status: 400 });
    }

    const deleted = deleteReadings(ids);

    if (deleted === 0) {
      return NextResponse.json({ error: '未找到要删除的读数' }, { status: 404 });
    }

    return NextResponse.json({ deleted });
  } catch (error) {
    return NextResponse.json({ error: '批量删除失败' }, { status: 500 });
  }
}
