import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const DEFAULT_SECRET = 'elec-meter-secret-key-change-in-production';

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || DEFAULT_SECRET;
  if (process.env.NODE_ENV === 'production' && secret === DEFAULT_SECRET) {
    throw new Error('生产环境必须设置 JWT_SECRET 环境变量');
  }
  return new TextEncoder().encode(secret);
}

// 无需认证的路径
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/check',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

// 安全响应头
function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 静态资源和公开路径直接放行
  if (
    isPublicPath(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$/)
  ) {
    const response = NextResponse.next();
    return addSecurityHeaders(response);
  }

  // 获取 token（优先 header，其次 cookie）
  const headerToken = request.headers.get('authorization')?.replace('Bearer ', '') || '';
  const cookieToken = request.cookies.get('auth_token')?.value || '';
  const token = headerToken || cookieToken;

  if (!token) {
    // API 路由返回 401
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
      return addSecurityHeaders(response);
    }
    // 页面路由重定向到登录
    const response = NextResponse.redirect(new URL('/login', request.url));
    return addSecurityHeaders(response);
  }

  try {
    await jwtVerify(token, getJwtSecret());
    const response = NextResponse.next();
    return addSecurityHeaders(response);
  } catch {
    // Token 无效
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
