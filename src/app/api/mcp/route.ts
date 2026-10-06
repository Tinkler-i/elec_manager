import { createMcpServer } from '@/lib/mcp-server';
import { verifyToken } from '@/lib/auth';
import { touchMcpKey, verifyMcpKey } from '@/lib/mcp-key';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/**
 * MCP Streamable HTTP Endpoint
 *
 * 实现标准 MCP 协议的 Streamable HTTP 传输。
 * AI 客户端（Claude Desktop、Cursor 等）可通过此端点与本系统进行 MCP 通信。
 *
 * 认证：`Authorization: Bearer <凭证>`，接受两种 ——
 *   · 独立的 MCP 密钥（`elecmcp_...`，客户端用，可在 MCP 页随时重新生成）
 *   · 登录会话的 JWT（浏览器里调试用）
 *
 * 为什么鉴权放在这里而不是 `src/proxy.ts`：proxy 跑在 Edge runtime，读不了
 * SQLite，也就没法查密钥哈希 —— 那样「重新生成即刻作废旧密钥」就实现不了。
 * 所以 `/api/mcp` 在 proxy 里是精确放行的，由本文件自己把关。
 *
 * 协议：MCP Streamable HTTP Transport (stateless mode)
 */

type AuthResult = { ok: true; via: 'session' | 'key' } | { ok: false };

function authorize(request: Request): AuthResult {
  const header = request.headers.get('authorization') ?? '';
  const credential = header.replace(/^Bearer\s+/i, '').trim();
  if (!credential) return { ok: false };

  // 先当会话 JWT 试（无状态，最快）
  if (verifyToken(credential)) return { ok: true, via: 'session' };

  if (verifyMcpKey(credential)) {
    touchMcpKey();
    return { ok: true, via: 'key' };
  }

  return { ok: false };
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: '未授权：请带上 MCP 密钥' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      // 让客户端知道该用 Bearer，而不是把 401 当成协议错误
      'WWW-Authenticate': 'Bearer',
    },
  });
}

async function handleMcpRequest(request: Request): Promise<Response> {
  if (!authorize(request).ok) {
    return unauthorized();
  }

  const server = createMcpServer();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,      // stateless mode
    enableJsonResponse: true,           // JSON response (no SSE streaming)
  });

  await server.connect(transport);

  try {
    const response = await transport.handleRequest(request);
    return response;
  } finally {
    await server.close();
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function GET(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
