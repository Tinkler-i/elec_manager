import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'readings';

    if (type === 'readings') {
      const readings = db.prepare('SELECT * FROM readings ORDER BY reading_date DESC').all() as Record<string, unknown>[];
      const csv = convertToCSV(readings);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="readings.csv"'
        }
      });
    }

    return NextResponse.json({ error: '无效的导出类型' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: '导出数据失败' }, { status: 500 });
  }
}

function convertToCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return String(value);
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}
