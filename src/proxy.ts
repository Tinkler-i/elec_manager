import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/check',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET 未初始化');
  }
  return new TextEncoder().encode(secret);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    isPublicPath(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$/)
  ) {
    const response = NextResponse.next();
    return addSecurityHeaders(response);
  }

  const headerToken = request.headers.get('authorization')?.replace('Bearer ', '') || '';
  const cookieToken = request.cookies.get('auth_token')?.value || '';
  const token = headerToken || cookieToken;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
      return addSecurityHeaders(response);
    }
    const response = NextResponse.redirect(new URL('/login', request.url));
    return addSecurityHeaders(response);
  }

  try {
    await jwtVerify(token, getJwtSecret());
    const response = NextResponse.next();
    return addSecurityHeaders(response);
  } catch {
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json({ error: '未授权，token 已失效' }, { status: 401 });
      return addSecurityHeaders(response);
    }
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('auth_token');
    return addSecurityHeaders(response);
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
