// ─── MCP 工具元数据：唯一来源 ───────────────────────────────────────────────
//
// 这里是 MCP 工具 name / title / description / 参数 schema 的**唯一定义处**。
// 两个消费方都从它派生，谁都不许再抄一份：
//   - src/lib/mcp-server.ts        → 直接拿 inputSchema 注册工具（MCP 客户端看到的）
//   - src/app/api/mcp/tools        → getToolInfoList() 转成 JSON Schema 给 /mcp 页面
//
// 为什么收成一处：原来 mcp-server.ts 和这个文件各写一份，9 个工具里漂移了 6 个；
// 其中 backup_database 那份还写着「存储在服务器 data/backups 目录下」，而 A2 之后
// 实际走 BACKUP_DIR（飞牛下是 TRIM_PKGVAR/backups，升级保留）。
//
// ⚠️ 改描述时请对着 handler 的**实际行为**写，别只对着另一份抄 —— 「两份一致但都
// 与现实不符」是光做对齐发现不了的。
//
// 本文件刻意不依赖 @modelcontextprotocol/sdk：/api/mcp/tools 只需要元数据，
// 不该为了拿它把 SDK 和 db 一起拉进那个路由。

import { z } from 'zod';
import type { McpToolInfo } from '../types';

// 类型定义在 src/types/index.ts，这里只做转出，避免同一形状写两遍
export type { McpToolInfo };

/** 一个工具的元数据：title / description / 参数 schema，三者只在这里写一次 */
export interface McpToolDef {
  title: string;
  description: string;
  /** zod 原始形状；MCP SDK 的 registerTool 直接吃这个 */
  inputSchema: z.ZodRawShape;
}

export const MCP_TOOLS = {
  add_reading: {
    title: '添加读数',
    description:
      '记录一条电表读数。系统自动计算与前一条读数的用电量差值；如果这是库里最早的一条读数，则以设置中的初始读数作为基准。读数必须按时间递增，不能小于前一条读数，也不能大于后一条读数。',
    inputSchema: {
      reading_value: z.number().describe('电表当前读数'),
      reading_date: z.string().describe('读数日期，格式 YYYY-MM-DD'),
      reading_time: z.string().optional().describe('记录时间，格式 HH:MM，用于区分同一天的多笔记录'),
      notes: z.string().optional().describe('可选备注信息'),
    },
  },
  list_readings: {
    title: '获取读数',
    description:
      '查询电表读数记录，可按日期范围筛选，结果按日期和时间降序排列（最新在前），每条都带该次的用电量。不传 limit 时返回全部匹配记录。',
    inputSchema: {
      start_date: z.string().optional().describe('开始日期 YYYY-MM-DD（含当天）'),
      end_date: z.string().optional().describe('结束日期 YYYY-MM-DD（含当天）'),
      limit: z.number().optional().describe('返回条数上限，不传则不限'),
    },
  },
  get_stats: {
    title: '用电统计',
    description: '获取用电统计概览：总读数次数、总用电量、总费用、本月用电量和本月费用。',
    inputSchema: {},
  },
  export_readings: {
    title: '导出数据',
    description: '导出全部电表读数记录，返回总条数与明细数据。',
    inputSchema: {
      type: z.literal('readings').describe('导出类型，目前仅支持 "readings"'),
    },
  },
  backup_database: {
    title: '备份数据库',
    description:
      '创建当前数据库的完整备份文件并返回文件名，写入服务器的备份目录（由 ELEC_BACKUP_DIR 指定，未设置时为数据目录下的 backups/）。返回时文件已经写完。',
    inputSchema: {},
  },
  get_reading: {
    title: '获取单条读数',
    description: '根据 ID 获取一条电表读数的详细信息。',
    inputSchema: {
      id: z.string().describe('读数的 UUID'),
    },
  },
  update_reading: {
    title: '编辑读数',
    description:
      '编辑一条已有的电表读数。可修改读数值、日期、时间和备注。修改后系统自动更新前后读数的用电量计算。读数必须保持时间递增的单调性。',
    inputSchema: {
      id: z.string().describe('要编辑的读数 UUID'),
      reading_value: z.number().optional().describe('新的电表读数'),
      reading_date: z.string().optional().describe('新的日期，格式 YYYY-MM-DD'),
      reading_time: z.string().optional().describe('新的记录时间，格式 HH:MM'),
      notes: z.string().optional().describe('新的备注信息'),
    },
  },
  delete_reading: {
    title: '删除读数',
    description: '删除一条电表读数记录。删除后系统自动修正前后读数的关联关系。此操作不可撤销。',
    inputSchema: {
      id: z.string().describe('要删除的读数 UUID'),
    },
  },
  get_settings: {
    title: '获取设置',
    description: '获取系统配置信息（电价费率、初始读数等非敏感项）。凭据类设置（登录密码、MCP 密钥）不会返回。',
    inputSchema: {},
  },
} satisfies Record<string, McpToolDef>;

/**
 * /mcp 页面用的 JSON Schema 视图。
 *
 * 从上面那份 zod 定义派生（zod 4 自带 toJSONSchema），不手写 —— 页面上看到的
 * 参数名、类型、说明、必填与否，与 MCP 客户端拿到的完全同源。
 */
export function getToolInfoList(): McpToolInfo[] {
  return Object.entries(MCP_TOOLS).map(([name, def]) => {
    const json = z.toJSONSchema(z.object(def.inputSchema)) as {
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };

    const properties = Object.fromEntries(
      Object.entries(json.properties ?? {}).map(([key, prop]) => [
        key,
        { type: prop.type ?? 'string', description: prop.description ?? '' },
      ]),
    );

    return {
      name,
      title: def.title,
      description: def.description,
      parameters: {
        type: 'object',
        properties,
        ...(json.required?.length ? { required: json.required } : {}),
      },
    };
  });
}
