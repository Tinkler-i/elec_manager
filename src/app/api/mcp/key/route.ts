import { NextResponse } from 'next/server';

import { generateMcpKey, getMcpKeyStatus, revokeMcpKey } from '@/lib/mcp-key';

/**
 * MCP 密钥管理。
 *
 * 这个路由**不在** proxy 的公开列表里 —— 生成和吊销密钥必须先是登录状态，
 * 否则拿到页面的人就能把别人的 MCP 客户端踢掉。
 */

export const dynamic = 'force-dynamic';

/** 查询状态。不返回密钥：库里只有哈希，服务端也拿不回明文。 */
export async function GET() {
  return NextResponse.json(getMcpKeyStatus());
}

/** 生成（或重新生成）密钥。明文只出现在这一个响应里。 */
export async function POST() {
  const key = generateMcpKey();
  return NextResponse.json({ key, ...getMcpKeyStatus() });
}

/** 吊销。 */
export async function DELETE() {
  revokeMcpKey();
  return NextResponse.json({ ok: true, ...getMcpKeyStatus() });
}
