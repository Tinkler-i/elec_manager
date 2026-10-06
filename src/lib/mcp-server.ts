import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  backupDatabase,
  createReading,
  deleteReading,
  findNextReading,
  findPreviousReading,
  getAllSettings,
  getReadingById,
  getReadings,
  getStats,
  updateReading,
} from './db';
import { toPublicSettings } from './settings-keys';
import { MCP_TOOLS } from './mcp-tools';

// Re-export for backward compatibility
export { getToolInfoList } from './mcp-tools';
export type { McpToolInfo } from './mcp-tools';

// ─── Tool Handler Helpers ───────────────────────────────────────────────────

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ─── Shared MCP Server Factory ──────────────────────────────────────────────

/**
 * 每个工具的 title / description / 参数 schema 都来自 mcp-tools.ts 的唯一定义，
 * 这里用 `{ ...MCP_TOOLS.x }` 展开。
 *
 * 别改成 `toolMeta(MCP_TOOLS.x)` 之类的 helper：实测那样会让 registerTool 推不出
 * inputSchema 的具体形状，handler 的 args 会退化成 any / unknown，9 个工具的参数
 * 全部失去类型检查。展开写法能保住逐字段的类型。
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'elec-meter',
    version: '1.9.1',
  });

  // ── 添加读数 ──────────────────────────────────────────────────────────
  server.registerTool('add_reading', { ...MCP_TOOLS.add_reading }, async (args) => {
    try {
      const { reading_value, reading_date, reading_time, notes } = args;
      const time = reading_time || null;

      // 同一天的多笔按 reading_time 排先后，口径见 db.ts 的 findAdjacentReading
      const prevReading = findPreviousReading(reading_date, time);
      const nextReading = findNextReading(reading_date, time);

      if (prevReading && reading_value < prevReading.reading_value) {
        return errorResult(`读数不能小于前一次读数 (${prevReading.reading_value})`);
      }
      if (nextReading && reading_value > nextReading.reading_value) {
        return errorResult(`读数不能大于后一次读数 (${nextReading.reading_value})`);
      }

      const newReading = createReading({
        reading_value,
        reading_date,
        reading_time: time,
        notes,
        source: 'mcp',
        created_by: 'ai',
      });
      return jsonResult(newReading);
    } catch (e) {
      console.error('MCP 工具 add_reading 失败:', e);
      return errorResult(e instanceof Error ? e.message : '添加读数失败');
    }
  });

  // ── 获取读数 ──────────────────────────────────────────────────────────
  server.registerTool('list_readings', { ...MCP_TOOLS.list_readings }, async (args) => {
    try {
      return jsonResult(getReadings({
        start: args.start_date,
        end: args.end_date,
        limit: args.limit,
      }));
    } catch (e) {
      console.error('MCP 工具 list_readings 失败:', e);
      return errorResult(e instanceof Error ? e.message : '查询读数失败');
    }
  });

  // ── 用电统计 ──────────────────────────────────────────────────────────
  server.registerTool('get_stats', { ...MCP_TOOLS.get_stats }, async () => {
    try {
      return jsonResult(getStats());
    } catch (e) {
      console.error('MCP 工具 get_stats 失败:', e);
      return errorResult(e instanceof Error ? e.message : '获取统计失败');
    }
  });

  // ── 导出数据 ──────────────────────────────────────────────────────────
  server.registerTool('export_readings', { ...MCP_TOOLS.export_readings }, async (args) => {
    try {
      // type 原来在 schema 里是必填、handler 却从未读它 —— 传 "stats" 也会静默拿到
      // readings。现在不传按 "readings" 处理（老客户端照旧），传别的值明确报错。
      const type = args.type ?? 'readings';
      if (type !== 'readings') {
        return errorResult(`不支持的导出类型：${type}（目前仅支持 "readings"）`);
      }

      const data = getReadings();
      return jsonResult({ count: data.length, data });
    } catch (e) {
      console.error('MCP 工具 export_readings 失败:', e);
      return errorResult(e instanceof Error ? e.message : '导出数据失败');
    }
  });

  // ── 备份数据库 ────────────────────────────────────────────────────────
  server.registerTool('backup_database', { ...MCP_TOOLS.backup_database }, async () => {
    try {
      // 与 HTTP 的 POST /api/backup 共用同一份实现，避免两条路径再分叉
      const fileName = await backupDatabase();
      return jsonResult({ message: '备份成功', fileName });
    } catch (e) {
      console.error('MCP 工具 backup_database 失败:', e);
      return errorResult(e instanceof Error ? e.message : '备份失败');
    }
  });

  // ── 获取单条读数 ────────────────────────────────────────────────────
  server.registerTool('get_reading', { ...MCP_TOOLS.get_reading }, async (args) => {
    try {
      const reading = getReadingById(args.id);
      if (!reading) {
        return errorResult('读数不存在');
      }
      return jsonResult(reading);
    } catch (e) {
      console.error('MCP 工具 get_reading 失败:', e);
      return errorResult(e instanceof Error ? e.message : '获取读数失败');
    }
  });

  // ── 编辑读数 ──────────────────────────────────────────────────────────
  server.registerTool('update_reading', { ...MCP_TOOLS.update_reading }, async (args) => {
    try {
      const { id, reading_value, reading_date, reading_time, notes } = args;

      const oldReading = getReadingById(id);
      if (!oldReading) {
        return errorResult('读数不存在');
      }

      const newValue = reading_value ?? oldReading.reading_value;
      const newDate = reading_date ?? oldReading.reading_date;
      const newTime = reading_time !== undefined ? (reading_time || null) : oldReading.reading_time;
      const newNotes = notes !== undefined ? notes : null;

      if (typeof newValue !== 'number' || !isFinite(newValue) || newValue < 0) {
        return errorResult('读数值必须是有效的非负数');
      }
      if (reading_date && !/^\d{4}-\d{2}-\d{2}$/.test(reading_date)) {
        return errorResult('日期格式不正确，应为 YYYY-MM-DD');
      }

      // 排除自己：否则「后一条」会查到自身
      const prevReading = findPreviousReading(newDate, newTime, id);
      const nextReading = findNextReading(newDate, newTime, id);

      if (prevReading && newValue < prevReading.reading_value) {
        return errorResult(`读数不能小于前一次读数 (${prevReading.reading_value})`);
      }
      if (nextReading && newValue > nextReading.reading_value) {
        return errorResult(`读数不能大于后一次读数 (${nextReading.reading_value})`);
      }

      const updatedReading = updateReading(id, {
        reading_value: newValue,
        reading_date: newDate,
        reading_time: newTime,
        notes: newNotes,
      });
      return jsonResult(updatedReading);
    } catch (e) {
      console.error('MCP 工具 update_reading 失败:', e);
      return errorResult(e instanceof Error ? e.message : '编辑读数失败');
    }
  });

  // ── 删除读数 ──────────────────────────────────────────────────────────
  server.registerTool('delete_reading', { ...MCP_TOOLS.delete_reading }, async (args) => {
    try {
      const { id } = args;

      if (!deleteReading(id)) {
        return errorResult('读数不存在');
      }

      return jsonResult({ message: '读数已删除', id });
    } catch (e) {
      console.error('MCP 工具 delete_reading 失败:', e);
      return errorResult(e instanceof Error ? e.message : '删除读数失败');
    }
  });

  // ── 获取设置 ──────────────────────────────────────────────────────────
  server.registerTool('get_settings', { ...MCP_TOOLS.get_settings }, async () => {
    try {
      // auth_password / mcp_key_* 不外发，名单见 src/lib/settings-keys.ts
      return jsonResult(toPublicSettings(getAllSettings()));
    } catch (e) {
      console.error('MCP 工具 get_settings 失败:', e);
      return errorResult(e instanceof Error ? e.message : '获取设置失败');
    }
  });

  return server;
}
