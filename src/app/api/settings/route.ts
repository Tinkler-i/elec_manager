import { NextRequest, NextResponse } from 'next/server';
import { getDb, invalidateSettingsCache } from '@/lib/db';
import { Setting } from '@/types';

export async function GET() {
  try {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM settings').all() as Setting[];
    const settingsObj = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, string>);
    return NextResponse.json(settingsObj);
  } catch (error) {
    return NextResponse.json({ error: '获取设置失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    const updateStmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    const oldSettings = db.prepare('SELECT * FROM settings').all() as Setting[];

    for (const [key, value] of Object.entries(body)) {
      updateStmt.run(key, value);
    }

    const newSettings = db.prepare('SELECT * FROM settings').all() as Setting[];

    invalidateSettingsCache();

    const settingsObj = newSettings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, string>);

    return NextResponse.json(settingsObj);
  } catch (error) {
    return NextResponse.json({ error: '更新设置失败' }, { status: 500 });
  }
}
