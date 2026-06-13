import { NextRequest, NextResponse } from 'next/server';
import { getMcpTools, callMcpTool } from '@/lib/mcp-server';
import { verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth_token')?.value;

    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
    }

    const tools = getMcpTools();
    return NextResponse.json({ tools });
  } catch (error) {
    return NextResponse.json({ error: '获取工具列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth_token')?.value;

    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { tool, params } = body;

    if (!tool) {
      return NextResponse.json({ error: '工具名称不能为空' }, { status: 400 });
    }

    const result = await callMcpTool(tool, params || {});
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '工具执行失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
