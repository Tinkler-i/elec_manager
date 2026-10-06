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
    return NextResponse.json({ error: '获取设置失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
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

    for (const [key, value] of Object.entries(body)) {
      // 值必须是字符串
      if (typeof value !== 'string') {
        return NextResponse.json({ error: `设置项 ${key} 的值必须是字符串` }, { status: 400 });
      }
      // 值长度限制
      if (value.length > 256) {
        return NextResponse.json({ error: `设置项 ${key} 的值过长` }, { status: 400 });
      }
      setSetting(key, value);
    }

    // 改了 rate_per_kwh / initial_reading，清掉 db.ts 里的设置缓存
    invalidateSettingsCache();

    // 返回时同样过滤敏感项
    return NextResponse.json(toPublicSettings(getAllSettings()));
  } catch (error) {
    return NextResponse.json({ error: '更新设置失败' }, { status: 500 });
  }
}
