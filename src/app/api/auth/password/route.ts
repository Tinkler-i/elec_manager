import { NextRequest, NextResponse } from 'next/server';
import { changePassword } from '@/lib/auth';
import { readJson } from '@/lib/read-json';

export async function PUT(request: NextRequest) {
  try {
    // 最敏感的一处：body 里就是新密码。解析失败必须挡在日志之外（见 src/lib/read-json.ts）
    const parsed = await readJson<{ password?: unknown }>(request);
    if (!parsed.ok) return parsed.response;
    const { password } = parsed.body;

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '请输入有效密码' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少需要 6 位' }, { status: 400 });
    }

    if (password.length > 128) {
      return NextResponse.json({ error: '密码不能超过 128 位' }, { status: 400 });
    }

    changePassword(password);

    return NextResponse.json({ success: true, message: '密码已修改' });
  } catch (error) {
    console.error('修改密码失败:', error);
    return NextResponse.json({ error: '修改密码失败' }, { status: 500 });
  }
}
