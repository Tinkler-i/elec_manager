import { NextRequest, NextResponse } from 'next/server';
import { getDb, invalidateSettingsCache } from '@/lib/db';
import { toPublicSettings } from '@/lib/settings-keys';
import { Setting } from '@/types';

// 允许通过 Settings API 修改的 key 白名单
const ALLOWED_KEYS = new Set(['rate_per_kwh', 'initial_reading']);

export async function GET() {
  try {
    const db = getDb();
    // 凭据类 key（auth_password、mcp_key_*）不外发，名单见 src/lib/settings-keys.ts
    const settings = db.prepare('SELECT key, value, updated_at FROM settings').all() as Setting[];
    return NextResponse.json(toPublicSettings(settings));
  } catch (error) {
    return NextResponse.json({ error: '获取设置失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    }

    // 验证所有 key 都在白名单内
    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.has(key)) {
        return NextResponse.json({ error: `不允许修改设置项: ${key}` }, { status: 403 });
      }
    }

    const updateStmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    for (const [key, value] of Object.entries(body)) {
      // 值必须是字符串
      if (typeof value !== 'string') {
        return NextResponse.json({ error: `设置项 ${key} 的值必须是字符串` }, { status: 400 });
      }
      // 值长度限制
      if (value.length > 256) {
        return NextResponse.json({ error: `设置项 ${key} 的值过长` }, { status: 400 });
      }
      updateStmt.run(key, value);
    }

    invalidateSettingsCache();

    // 返回时同样过滤敏感项
    const newSettings = db.prepare('SELECT key, value, updated_at FROM settings').all() as Setting[];

    return NextResponse.json(toPublicSettings(newSettings));
  } catch (error) {
    return NextResponse.json({ error: '更新设置失败' }, { status: 500 });
  }
}
