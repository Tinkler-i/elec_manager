import { NextRequest, NextResponse } from 'next/server';

import {
  McpKeyValidationError,
  createMcpKey,
  listMcpKeys,
  revokeAllMcpKeys,
  revokeMcpKey,
  updateMcpKeyNote,
} from '@/lib/mcp-key';
import { readJson } from '@/lib/read-json';

/**
 * MCP 密钥管理（多把）。
 *
 * 这个路由**不在** proxy 的公开列表里 —— 生成、改备注、吊销都必须先是登录状态，
 * 否则拿到页面的人就能把别人的 MCP 客户端踢掉。
 *
 * 响应契约（与前端并行开发，别单方面改）：
 *   GET    → 200 { keys: McpKeyInfo[] }
 *   POST   → 201 { key, info }        key 明文**只在这个响应里出现一次**
 *   PATCH  → 200 { info }             404 密钥不存在
 *   DELETE → 200 { ok: true, revoked: N }（带 ?id= 时 N=1，id 不存在则 404）
 *
 * 列表和 info 都**不含 hash** —— 库里只有哈希，服务端也拿不回明文。
 */

export const dynamic = 'force-dynamic';

/** 列表。只返回 id / 备注 / 时间。 */
export async function GET() {
  return NextResponse.json({ keys: listMcpKeys() });
}

/** 生成一把新密钥。明文只出现在这一个响应里。 */
export async function POST(request: NextRequest) {
  try {
    // body 是可选的：这个接口原来是 POST 无 body 直接生成。前端可能不带 body，
    // 也可能带 { note }。
    // 用 clone() 先探一下原文是不是空的：空 body 交给 readJson 会被判成「畸形 JSON」
    // 返回 400，把「不带备注生成」这条正常用法挡掉。clone 不消费原 request，所以非空时
    // 仍由 readJson 解析 —— 泄漏防护只有那一处，不在这里重复实现一遍解析。
    // （别改成判断 request.body === null：实测 Next 对无 body 的 POST 给的也是一个
    //   非 null 的空流，那个判断不成立。）
    const raw = await request.clone().text();
    const parsed =
      raw.trim() === ''
        ? { ok: true as const, body: {} as { note?: unknown } }
        : await readJson<{ note?: unknown }>(request);
    if (!parsed.ok) return parsed.response;

    const note = parsed.body.note;
    if (note !== undefined && note !== null && typeof note !== 'string') {
      return NextResponse.json({ error: '备注必须是字符串' }, { status: 400 });
    }

    const { key, info } = createMcpKey(note);
    return NextResponse.json({ key, info }, { status: 201 });
  } catch (error) {
    // 校验类错误（备注超长 / 超出上限）是客户端输入问题 → 400，并把原因说清楚
    if (error instanceof McpKeyValidationError) {
      console.error('生成 MCP 密钥被拒绝（输入不合法）:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('生成 MCP 密钥失败:', error);
    return NextResponse.json({ error: '生成 MCP 密钥失败' }, { status: 500 });
  }
}

/** 改备注。note 传 null（或空串）表示清掉备注。 */
export async function PATCH(request: NextRequest) {
  try {
    const parsed = await readJson<{ id?: unknown; note?: unknown }>(request);
    if (!parsed.ok) return parsed.response;
    const { id, note } = parsed.body;

    if (typeof id !== 'string' || id.length === 0) {
      return NextResponse.json({ error: '缺少密钥 id' }, { status: 400 });
    }
    // 契约里 PATCH 必须带 note：undefined 说明调用方漏了字段，别默默当成「清空」
    if (note !== null && typeof note !== 'string') {
      return NextResponse.json({ error: '备注必须是字符串或 null' }, { status: 400 });
    }

    const info = updateMcpKeyNote(id, note);
    if (!info) {
      return NextResponse.json({ error: '密钥不存在' }, { status: 404 });
    }
    return NextResponse.json({ info });
  } catch (error) {
    if (error instanceof McpKeyValidationError) {
      console.error('修改 MCP 密钥备注被拒绝（输入不合法）:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('修改 MCP 密钥备注失败:', error);
    return NextResponse.json({ error: '修改 MCP 密钥备注失败' }, { status: 500 });
  }
}

/** 吊销：带 `?id=` 吊销一把，不带则吊销全部。 */
export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('id');

    if (!id) {
      return NextResponse.json({ ok: true, revoked: revokeAllMcpKeys() });
    }
    if (!revokeMcpKey(id)) {
      return NextResponse.json({ error: '密钥不存在' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, revoked: 1 });
  } catch (error) {
    console.error('吊销 MCP 密钥失败:', error);
    return NextResponse.json({ error: '吊销 MCP 密钥失败' }, { status: 500 });
  }
}
