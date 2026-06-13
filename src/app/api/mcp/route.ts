import { createMcpServer } from '@/lib/mcp-server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/**
 * MCP Streamable HTTP Endpoint
 *
 * 实现标准 MCP 协议的 Streamable HTTP 传输。
 * AI 客户端（Claude Desktop、Cursor 等）可通过此端点与本系统进行 MCP 通信。
 *
 * 认证：通过 middleware 校验 Authorization: Bearer <token>
 * 协议：MCP Streamable HTTP Transport (stateless mode)
 */

async function handleMcpRequest(request: Request): Promise<Response> {
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
