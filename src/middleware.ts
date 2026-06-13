import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'elec-meter-secret-key-change-in-production'
);

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 静态资源和公开路径直接放行
  if (
    isPublicPath(pathname) ||
    pathname.startsWith('/_next') ||
    pathname.match(/\.(svg|png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$/)
  ) {
    return NextResponse.next();
  }

  // 获取 token（优先 header，其次 cookie）
  const headerToken = request.headers.get('authorization')?.replace('Bearer ', '') || '';
  const cookieToken = request.cookies.get('auth_token')?.value || '';
  const token = headerToken || cookieToken;

  if (!token) {
    // API 路由返回 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
    }
    // 页面路由重定向到登录
    return NextResponse.redirect(new URL('/login', request.url));
  }

  try {
    await jwtVerify(token, JWT_SECRET);
    return NextResponse.next();
  } catch {
    // Token 无效
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: '未授权，token 已失效' }, { status: 401 });
    }
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('auth_token');
    return response;
  }
}

export const config = {
  matcher: [
    // 匹配所有路径，排除 node_modules 和 .next
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
