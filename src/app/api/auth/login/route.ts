import { NextRequest, NextResponse } from 'next/server';
import { initializeAuth, verifyPassword, generateToken } from '@/lib/auth';

// 简单的内存速率限制（按 IP）
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;           // 最大尝试次数
const WINDOW_MS = 15 * 60 * 1000;  // 15 分钟窗口

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return false;
  }

  entry.count++;
  return true;
}

// 定期清理过期记录（每 30 分钟）
let lastCleanup = Date.now();
function cleanupRateLimit() {
  const now = Date.now();
  if (now - lastCleanup < 30 * 60 * 1000) return;
  lastCleanup = now;
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    cleanupRateLimit();

    const ip = getClientIp(request);
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: '登录尝试次数过多，请 15 分钟后再试' },
        { status: 429 }
      );
    }

    initializeAuth();

    const body = await request.json();
    const { password, remember } = body;

    if (!password) {
      return NextResponse.json({ error: '请输入密码' }, { status: 400 });
    }

    // 密码长度限制
    if (typeof password !== 'string' || password.length > 128) {
      return NextResponse.json({ error: '密码格式不正确' }, { status: 400 });
    }

    if (!verifyPassword(password)) {
      return NextResponse.json({ error: '密码错误' }, { status: 401 });
    }

    const token = generateToken();
    const maxAge = remember ? 365 * 24 * 60 * 60 : 24 * 60 * 60;

    // 登录成功后重置该 IP 的速率限制
    rateLimitMap.delete(ip);

    // 根据实际请求协议判断 secure，而非 NODE_ENV
    // 支持反向代理通过 X-Forwarded-Proto 传递 HTTPS 信息
    const isSecure =
      request.nextUrl.protocol === 'https:' ||
      request.headers.get('x-forwarded-proto') === 'https';

    const response = NextResponse.json({ success: true, token });
    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      maxAge,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: '登录失败' }, { status: 500 });
  }
}
