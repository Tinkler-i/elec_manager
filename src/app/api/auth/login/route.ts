import { NextRequest, NextResponse } from 'next/server';
import { initializeAuth, verifyPassword, generateToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    initializeAuth();

    const body = await request.json();
    const { password, remember } = body;

    if (!password) {
      return NextResponse.json({ error: '请输入密码' }, { status: 400 });
    }

    if (!verifyPassword(password)) {
      return NextResponse.json({ error: '密码错误' }, { status: 401 });
    }

    const token = generateToken();
    const maxAge = remember ? 365 * 24 * 60 * 60 : 24 * 60 * 60;

    const response = NextResponse.json({ success: true, token });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: `登录失败: ${message}` }, { status: 500 });
  }
}
