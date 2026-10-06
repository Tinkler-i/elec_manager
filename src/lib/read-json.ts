import { NextResponse, type NextRequest } from 'next/server';

/**
 * 读 JSON 请求体 —— 解析失败时**不把原文带进异常，也不带进日志**。
 *
 * 为什么不能用 `await request.json()` 裸着写：
 * 解析失败抛的 `SyntaxError`，**V8 会把原始输入的约 11 个字符窗口拼进 message**。
 * 实测（2026-10，真实 HTTP + standalone 构建）：
 *
 *   body: `{"password":"SuperSecretQA12345"`   （少了右括号，畸形 JSON）
 *   日志: `登录失败: SyntaxError: Unexpected token 'S', ..."assword": SuperSecre"... is not valid JSON`
 *
 *   body: `{"password":"ShortQA1"`             （短值 ≤11 字符会**整体**进日志）
 *   日志: `登录失败: SyntaxError: Unexpected token 'S', "ShortQA1" is not valid JSON`
 *
 * 只要路由的 catch 把 error 记进日志，**请求体片段（可能是新密码、凭据）就落进服务端日志**。
 * 所以解析这一步必须在这里收口：失败就返回 400，日志只写固定文案。
 *
 * 用法：
 *   const parsed = await readJson<{ password?: unknown }>(request);
 *   if (!parsed.ok) return parsed.response;   // 400，日志里没有 body 内容
 *   const { password } = parsed.body;
 *
 * 注意返回 400 而不是 500：**畸形请求体是客户端错误**，不是服务端故障。
 */
export type ReadJsonResult<T> = { ok: true; body: T } | { ok: false; response: NextResponse };

/**
 * @param request Next 的请求对象
 * @returns `{ ok: true, body }` 或 `{ ok: false, response }`（已构造好的 400 响应）
 *
 * 类型参数由调用方声明：JSON 解析出来的是没有运行时保证的数据，调用方仍要按字段做
 * `typeof` 校验（本仓库的路由都做了）。这里集中做一次 `any → T` 的转换，免得每个
 * 路由各自 `as`。
 */
export async function readJson<T = unknown>(request: NextRequest): Promise<ReadJsonResult<T>> {
  try {
    return { ok: true, body: (await request.json()) as T };
  } catch {
    // 故意不接异常对象、也绝不把 error.message 写进日志 —— 见文件头说明
    console.warn('请求体不是合法 JSON（按 400 处理；内容不入日志）');
    return {
      ok: false,
      response: NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 }),
    };
  }
}
