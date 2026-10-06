import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/check',
  '/favicon.ico',
];

/**
 * 只做完全匹配的放行路径。
 *
 * `/api/mcp` 自带鉴权（会话 JWT 或独立 MCP 密钥），必须在 route 里校验而不是
 * 这里 —— proxy 跑在 Edge runtime，读不了 SQLite，查不了密钥哈希。
 *
 * 单独列一个数组而不是塞进 PUBLIC_PATHS：后者是前缀匹配，会把 `/api/mcp/key`
 * （生成/吊销密钥，必须先是登录状态）和 `/api/mcp/tools` 一起放行。
 */
const PUBLIC_EXACT_PATHS = ['/api/mcp'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.includes(pathname)) return true;
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
}

/**
 * 密钥拿不到 ≠ token 无效。
 *
 * 前者是服务端配置故障（JWT_SECRET 没初始化，通常是 src/instrumentation.ts
 * 没跑起来），后者才是用户凭证的问题。用专门的错误类型区分开，别让一个 catch
 * 把两种失败一锅端 —— 否则服务端故障会被伪装成「你被登出了」。
 */
class JwtSecretUnavailableError extends Error {
  constructor() {
    super('JWT_SECRET 未初始化');
    this.name = 'JwtSecretUnavailableError';
  }
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new JwtSecretUnavailableError();
  }
  return new TextEncoder().encode(secret);
}

/**
 * 密钥不可用时的响应：**503，且不动用户的 cookie**。
 *
 * 为什么是 503 而不是 401 或 302 到登录页：
 *  · 401 的含义是「你的凭证不对」，会把服务端故障说成用户的问题；
 *  · 302 到 /login 会把故障藏起来 —— 用户只觉得自己又被登出了，运维在日志里
 *    也看不到（这正是 A5 修复前那个 bug 难查的原因）；
 *  · 503 是「服务端暂时不可用」，监控和健康检查能直接发现，配合 Retry-After
 *    表达这是暂时的、值得重试。
 *
 * cookie 原样保留：密钥恢复后原来的会话还能用，不需要用户重新登录。
 * 另外 /login 与 /api/auth/login 是放行的，所以恢复入口始终打得开 —— 打一次
 * 登录接口就会让 auth.ts 把密钥初始化好。
 */
function secretUnavailableResponse(pathname: string): NextResponse {
  console.error(
    `[proxy] JWT_SECRET 不可用，无法校验会话：这是服务端初始化失败，不是用户 token 失效。` +
    `请检查 src/instrumentation.ts 的 register() 是否执行。path=${pathname}`,
  );

  const retryAfter = { 'Retry-After': '5' };

  if (pathname.startsWith('/api/')) {
    return addSecurityHeaders(
      NextResponse.json({ error: '服务端认证未就绪，请稍后重试' }, { status: 503, headers: retryAfter }),
    );
  }

  return addSecurityHeaders(
    new NextResponse('服务端认证未就绪，请稍后重试。若持续出现，请查看服务日志里的 JWT_SECRET 报错。', {
      status: 503,
      headers: { ...retryAfter, 'Content-Type': 'text/plain; charset=utf-8' },
    }),
  );
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

  // 1) 先取密钥。取不到是服务端故障，单独处理，绝不删 cookie
  let secret: Uint8Array;
  try {
    secret = getJwtSecret();
  } catch (e) {
    if (e instanceof JwtSecretUnavailableError) {
      return secretUnavailableResponse(pathname);
    }
    throw e;
  }

  // 2) 再验 token。无效/过期保持原行为：API 401，页面跳登录页并清 cookie
  try {
    await jwtVerify(token, secret);
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
