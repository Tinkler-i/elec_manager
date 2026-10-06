import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, invalidateSettingsCache, setSetting } from '@/lib/db';
import { toPublicSettings } from '@/lib/settings-keys';

// 允许通过 Settings API 修改的 key 白名单
const ALLOWED_KEYS = new Set(['rate_per_kwh', 'initial_reading']);

export async function GET() {
  try {
    // 凭据类 key（auth_password、mcp_key_*）不外发，名单见 src/lib/settings-keys.ts
    return NextResponse.json(toPublicSettings(getAllSettings()));
  } catch (error) {
    console.error('获取设置失败:', error);
    return NextResponse.json({ error: '获取设置失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: '请求格式不正确' }, { status: 400 });
    }

    const entries = Object.entries(body);

    // 先把所有 key 和值校验完，再统一落盘。
    // 边校验边写的话，中途报 400 会留下半套写入 —— 调用方看到「失败」却已经有副作用。
    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.has(key)) {
        return NextResponse.json({ error: `不允许修改设置项: ${key}` }, { status: 403 });
      }
    }

    // 值也一并校验完，收集成待写列表；中途任何一项不合格就整体放弃，不留半套写入
    const updates: Array<[string, string]> = [];
    for (const [key, value] of entries) {
      // 值必须是字符串
      if (typeof value !== 'string') {
        return NextResponse.json({ error: `设置项 ${key} 的值必须是字符串` }, { status: 400 });
      }
      // 值长度限制
      if (value.length > 256) {
        return NextResponse.json({ error: `设置项 ${key} 的值过长` }, { status: 400 });
      }
      updates.push([key, value]);
    }

    // 校验全过才落盘
    for (const [key, value] of updates) {
      setSetting(key, value);
    }

    // 全部写成功之后再清缓存：setSetting 刻意不自动清（见 db.ts 的注释），
    // 而 rate_per_kwh / initial_reading 都被 getRatePerKwh / getInitialReading 缓存着。
    invalidateSettingsCache();

    // 返回时同样过滤敏感项
    return NextResponse.json(toPublicSettings(getAllSettings()));
  } catch (error) {
    console.error('更新设置失败:', error);
    return NextResponse.json({ error: '更新设置失败' }, { status: 500 });
  }
}
