import { NextRequest, NextResponse } from 'next/server';
import { changePassword } from '@/lib/auth';

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

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
    return NextResponse.json({ error: '修改密码失败' }, { status: 500 });
  }
}
