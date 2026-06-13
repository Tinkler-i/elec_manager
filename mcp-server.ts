#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "elec-meter",
  version: "1.0.0",
});

const API_BASE = process.env.ELEC_API_URL || "http://localhost:16543";
const AUTH_TOKEN = process.env.ELEC_AUTH_TOKEN || "";

async function apiGet(path: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: AUTH_TOKEN ? { "Authorization": `Bearer ${AUTH_TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`API错误: ${res.statusText}`);
  return res.json();
}

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(AUTH_TOKEN ? { "Authorization": `Bearer ${AUTH_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "API错误");
  return data;
}

server.tool(
  "添加读数",
  "记录一条电表读数。系统自动计算用电量。读数必须按时间递增。",
  {
    reading_value: z.number().describe("电表当前读数"),
    reading_date: z.string().describe("读数日期，格式 YYYY-MM-DD"),
    notes: z.string().optional().describe("可选备注"),
  },
  async ({ reading_value, reading_date, notes }) => {
    const result = await apiPost("/api/mcp", {
      tool: "添加读数",
      params: { reading_value, reading_date, notes },
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "获取读数",
  "查询电表读数记录，支持按日期范围筛选。",
  {
    start_date: z.string().optional().describe("开始日期 YYYY-MM-DD"),
    end_date: z.string().optional().describe("结束日期 YYYY-MM-DD"),
    limit: z.number().optional().describe("返回数量限制"),
  },
  async ({ start_date, end_date, limit }) => {
    const params: Record<string, unknown> = {};
    if (start_date) params.start_date = start_date;
    if (end_date) params.end_date = end_date;
    if (limit) params.limit = limit;

    const result = await apiPost("/api/mcp", {
      tool: "获取读数",
      params,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "用电统计",
  "获取电表用电统计概览，包括总用电量、本月用电量和费用。",
  {},
  async () => {
    const result = await apiPost("/api/mcp", {
      tool: "用电统计",
      params: {},
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "审计日志",
  "查询系统操作日志，追溯数据变更历史。",
  {
    source: z.string().optional().describe("来源筛选：ui/mcp/api"),
    limit: z.number().optional().describe("返回数量限制"),
  },
  async ({ source, limit }) => {
    const params: Record<string, unknown> = {};
    if (source) params.source = source;
    if (limit) params.limit = limit;

    const result = await apiPost("/api/mcp", {
      tool: "审计日志",
      params,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "导出数据",
  "导出电表读数数据。",
  {
    type: z.literal("readings").describe("导出类型"),
  },
  async ({ type }) => {
    const result = await apiPost("/api/mcp", {
      tool: "导出数据",
      params: { type },
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "备份数据库",
  "创建数据库备份。",
  {},
  async () => {
    const result = await apiPost("/api/mcp", {
      tool: "备份数据库",
      params: {},
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "获取设置",
  "获取系统配置，包括电价费率和初始读数。",
  {},
  async () => {
    const result = await apiPost("/api/mcp", {
      tool: "获取设置",
      params: {},
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("电表MCP服务器已启动");
}

main().catch(console.error);
