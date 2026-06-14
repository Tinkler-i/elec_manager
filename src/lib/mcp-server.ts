import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, generateId, getRatePerKwh } from './db';
import fs from 'fs';
import path from 'path';

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

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'elec-meter',
    version: '1.9.1',
  });

  // ── 添加读数 ──────────────────────────────────────────────────────────
  server.registerTool('add_reading', {
    title: '添加读数',
    description: '记录一条电表读数。系统自动计算用电量。读数必须按时间递增，不能小于前一条读数，也不能大于后一条读数。',
    inputSchema: {
      reading_value: z.number().describe('电表当前读数'),
      reading_date: z.string().describe('读数日期，格式 YYYY-MM-DD'),
      reading_time: z.string().optional().describe('记录时间，格式 HH:MM，用于区分同一天的多笔记录'),
      notes: z.string().optional().describe('可选备注信息'),
    },
  }, async (args) => {
    try {
      const db = getDb();
      const { reading_value, reading_date, reading_time, notes } = args;
      const time = reading_time || null;

      const prevReading = db.prepare(
        `SELECT reading_value FROM readings WHERE reading_date < ? OR (reading_date = ? AND COALESCE(reading_time, '') < COALESCE(?, '')) ORDER BY reading_date DESC, reading_time DESC LIMIT 1`
      ).get(reading_date, reading_date, time ?? '') as { reading_value: number } | undefined;

      const nextReading = db.prepare(
        `SELECT reading_value FROM readings WHERE reading_date > ? OR (reading_date = ? AND COALESCE(reading_time, '') > COALESCE(?, '')) ORDER BY reading_date ASC, reading_time ASC LIMIT 1`
      ).get(reading_date, reading_date, time ?? '') as { reading_value: number } | undefined;

      if (prevReading && reading_value < prevReading.reading_value) {
        return errorResult(`读数不能小于前一次读数 (${prevReading.reading_value})`);
      }
      if (nextReading && reading_value > nextReading.reading_value) {
        return errorResult(`读数不能大于后一次读数 (${nextReading.reading_value})`);
      }

      let previous_reading: number | null = prevReading?.reading_value ?? null;
      if (!prevReading) {
        const initialSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('initial_reading') as { value: string } | undefined;
        previous_reading = initialSetting ? parseFloat(initialSetting.value) : null;
      }

      const id = generateId();
      db.prepare(`
        INSERT INTO readings (id, reading_value, reading_date, reading_time, previous_reading, notes, source, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'mcp', 'ai')
      `).run(id, reading_value, reading_date, time, previous_reading, notes || null);

      const newReading = db.prepare('SELECT * FROM readings WHERE id = ?').get(id);
      return jsonResult(newReading);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '添加读数失败');
    }
  });

  // ── 获取读数 ──────────────────────────────────────────────────────────
  server.registerTool('list_readings', {
    title: '获取读数',
    description: '查询电表读数记录，支持按日期范围筛选，数据按日期降序排列。',
    inputSchema: {
      start_date: z.string().optional().describe('开始日期 YYYY-MM-DD'),
      end_date: z.string().optional().describe('结束日期 YYYY-MM-DD'),
      limit: z.number().optional().describe('返回数量上限'),
    },
  }, async (args) => {
    try {
      const db = getDb();
      let query = 'SELECT * FROM readings WHERE 1=1';
      const params: unknown[] = [];

      if (args.start_date) {
        query += ' AND reading_date >= ?';
        params.push(args.start_date);
      }
      if (args.end_date) {
        query += ' AND reading_date <= ?';
        params.push(args.end_date);
      }
      query += ' ORDER BY reading_date DESC, reading_time DESC';
      if (args.limit) {
        query += ' LIMIT ?';
        params.push(args.limit);
      }

      const rows = db.prepare(query).all(...params);
      return jsonResult(rows);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '查询读数失败');
    }
  });

  // ── 用电统计 ──────────────────────────────────────────────────────────
  server.registerTool('get_stats', {
    title: '用电统计',
    description: '获取用电统计概览：总读数次数、总用电量、总费用、本月用电量和本月费用。',
    inputSchema: {},
  }, async () => {
    try {
      const db = getDb();
      const totalReadings = (db.prepare('SELECT COUNT(*) as count FROM readings').get() as { count: number }).count;
      const totalConsumed = (db.prepare('SELECT COALESCE(SUM(units_consumed), 0) as total FROM readings').get() as { total: number }).total;

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const currentMonthConsumed = (db.prepare(
        `SELECT COALESCE(SUM(units_consumed), 0) as total FROM readings WHERE reading_date LIKE ? || '%'`
      ).get(currentMonth) as { total: number }).total;

      const ratePerKwh = getRatePerKwh();
      return jsonResult({
        totalReadings,
        totalConsumed,
        totalAmount: totalConsumed * ratePerKwh,
        currentMonthConsumed,
        currentMonthAmount: currentMonthConsumed * ratePerKwh,
      });
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '获取统计失败');
    }
  });

  // ── 导出数据 ──────────────────────────────────────────────────────────
  server.registerTool('export_readings', {
    title: '导出数据',
    description: '导出所有电表读数数据。',
    inputSchema: {
      type: z.literal('readings').describe('导出类型，目前仅支持 "readings"'),
    },
  }, async (args) => {
    try {
      const db = getDb();
      const data = db.prepare('SELECT * FROM readings ORDER BY reading_date DESC, reading_time DESC').all();
      return jsonResult({ count: (data as unknown[]).length, data });
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '导出数据失败');
    }
  });

  // ── 备份数据库 ────────────────────────────────────────────────────────
  server.registerTool('backup_database', {
    title: '备份数据库',
    description: '创建当前数据库的完整备份文件。',
    inputSchema: {},
  }, async () => {
    try {
      const db = getDb();
      const backupDir = path.join(process.cwd(), 'data', 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `elec-backup-${timestamp}.db`;
      await db.backup(path.join(backupDir, fileName));
      return jsonResult({ message: '备份成功', fileName });
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '备份失败');
    }
  });

  // ── 获取单条读数 ────────────────────────────────────────────────────
  server.registerTool('get_reading', {
    title: '获取单条读数',
    description: '根据 ID 获取一条电表读数的详细信息。',
    inputSchema: {
      id: z.string().describe('读数的 UUID'),
    },
  }, async (args) => {
    try {
      const db = getDb();
      const reading = db.prepare('SELECT * FROM readings WHERE id = ?').get(args.id);
      if (!reading) {
        return errorResult('读数不存在');
      }
      return jsonResult(reading);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '获取读数失败');
    }
  });

  // ── 编辑读数 ──────────────────────────────────────────────────────────
  server.registerTool('update_reading', {
    title: '编辑读数',
    description: '编辑一条已有的电表读数。可修改读数值、日期、时间和备注。修改后系统自动更新前后读数的用电量计算。读数必须保持时间递增的单调性。',
    inputSchema: {
      id: z.string().describe('要编辑的读数 UUID'),
      reading_value: z.number().optional().describe('新的电表读数'),
      reading_date: z.string().optional().describe('新的日期，格式 YYYY-MM-DD'),
      reading_time: z.string().optional().describe('新的记录时间，格式 HH:MM'),
      notes: z.string().optional().describe('新的备注信息'),
    },
  }, async (args) => {
    try {
      const db = getDb();
      const { id, reading_value, reading_date, reading_time, notes } = args;

      const oldReading = db.prepare('SELECT * FROM readings WHERE id = ?').get(id) as {
        id: string; reading_value: number; reading_date: string; reading_time: string | null; previous_reading: number | null;
      } | undefined;
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

      const prevReading = db.prepare(
        `SELECT reading_value FROM readings WHERE (reading_date < ? OR (reading_date = ? AND COALESCE(reading_time, '') < COALESCE(?, ''))) AND id != ? ORDER BY reading_date DESC, reading_time DESC LIMIT 1`
      ).get(newDate, newDate, newTime ?? '', id) as { reading_value: number } | undefined;

      const nextReading = db.prepare(
        `SELECT reading_value FROM readings WHERE (reading_date > ? OR (reading_date = ? AND COALESCE(reading_time, '') > COALESCE(?, ''))) AND id != ? ORDER BY reading_date ASC, reading_time ASC LIMIT 1`
      ).get(newDate, newDate, newTime ?? '', id) as { reading_value: number } | undefined;

      if (prevReading && newValue < prevReading.reading_value) {
        return errorResult(`读数不能小于前一次读数 (${prevReading.reading_value})`);
      }
      if (nextReading && newValue > nextReading.reading_value) {
        return errorResult(`读数不能大于后一次读数 (${nextReading.reading_value})`);
      }

      const transaction = db.transaction(() => {
        db.prepare(
          'UPDATE readings SET reading_value = ?, reading_date = ?, reading_time = ?, notes = ? WHERE id = ?'
        ).run(newValue, newDate, newTime, newNotes, id);

        const nextForCascade = db.prepare(
          `SELECT id, previous_reading FROM readings WHERE reading_date > ? OR (reading_date = ? AND COALESCE(reading_time, '') > COALESCE(?, '')) ORDER BY reading_date ASC, reading_time ASC LIMIT 1`
        ).get(oldReading.reading_date, oldReading.reading_date, oldReading.reading_time ?? '') as { id: string; previous_reading: number } | undefined;
        if (nextForCascade && nextForCascade.previous_reading === oldReading.reading_value) {
          db.prepare('UPDATE readings SET previous_reading = ? WHERE id = ?').run(newValue, nextForCascade.id);
        }
      });

      transaction();

      const updatedReading = db.prepare('SELECT * FROM readings WHERE id = ?').get(id);
      return jsonResult(updatedReading);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '编辑读数失败');
    }
  });

  // ── 删除读数 ──────────────────────────────────────────────────────────
  server.registerTool('delete_reading', {
    title: '删除读数',
    description: '删除一条电表读数记录。删除后系统自动修正前后读数的关联关系。此操作不可撤销。',
    inputSchema: {
      id: z.string().describe('要删除的读数 UUID'),
    },
  }, async (args) => {
    try {
      const db = getDb();
      const { id } = args;

      const oldReading = db.prepare('SELECT * FROM readings WHERE id = ?').get(id) as {
        id: string; reading_value: number; reading_date: string; reading_time: string | null;
      } | undefined;
      if (!oldReading) {
        return errorResult('读数不存在');
      }

      const prevReading = db.prepare(
        `SELECT reading_value FROM readings WHERE reading_date < ? OR (reading_date = ? AND COALESCE(reading_time, '') < COALESCE(?, '')) ORDER BY reading_date DESC, reading_time DESC LIMIT 1`
      ).get(oldReading.reading_date, oldReading.reading_date, oldReading.reading_time ?? '') as { reading_value: number } | undefined;

      const newPreviousReading = prevReading?.reading_value ?? null;

      const transaction = db.transaction(() => {
        db.prepare('DELETE FROM readings WHERE id = ?').run(id);
        db.prepare(
          `UPDATE readings SET previous_reading = ? WHERE (reading_date > ? OR (reading_date = ? AND COALESCE(reading_time, '') > COALESCE(?, ''))) AND previous_reading = ?`
        ).run(newPreviousReading, oldReading.reading_date, oldReading.reading_date, oldReading.reading_time ?? '', oldReading.reading_value);
      });

      transaction();

      return jsonResult({ message: '读数已删除', id });
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '删除读数失败');
    }
  });

  // ── 获取设置 ──────────────────────────────────────────────────────────
  server.registerTool('get_settings', {
    title: '获取设置',
    description: '获取系统配置信息，包括电价费率和初始读数。',
    inputSchema: {},
  }, async () => {
    try {
      const db = getDb();
      const settings = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
      const result: Record<string, string> = {};
      settings.forEach(s => { result[s.key] = s.value; });
      return jsonResult(result);
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : '获取设置失败');
    }
  });

  return server;
}
