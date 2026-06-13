import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, generateToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;

  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  // 返回当前有效的 token（供 MCP 客户端配置使用）
  return NextResponse.json({ token });
}
