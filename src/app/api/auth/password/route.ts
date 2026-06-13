import { NextRequest, NextResponse } from 'next/server';
import { changePassword } from '@/lib/auth';

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    if (!password || password.length < 4) {
      return NextResponse.json({ error: '密码至少需要4位' }, { status: 400 });
    }

    changePassword(password);

    return NextResponse.json({ success: true, message: '密码已修改' });
  } catch (error) {
    return NextResponse.json({ error: '修改密码失败' }, { status: 500 });
  }
}
