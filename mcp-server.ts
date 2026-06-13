#!/usr/bin/env node

/**
 * 电表数据管理 - MCP Stdio Server
 *
 * 独立 MCP 服务器，通过标准输入/输出 (stdio) 与 AI 客户端通信。
 * 直接访问 SQLite 数据库，无需通过 HTTP API。
 *
 * 用法：npx tsx mcp-server.ts
 *
 * 配置示例 (Claude Desktop / Cursor)：
 * {
 *   "mcpServers": {
 *     "elec-meter": {
 *       "command": "npx",
 *       "args": ["tsx", "/path/to/mcp-server.ts"],
 *       "env": {
 *         "ELEC_DB_PATH": "/path/to/data/elec.db"
 *       }
 *     }
 *   }
 * }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './src/lib/mcp-server';

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ElecMeter MCP] stdio 服务器已启动');
}

main().catch((err) => {
  console.error('[ElecMeter MCP] 启动失败:', err);
  process.exit(1);
});
