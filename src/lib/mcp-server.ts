import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, generateId, getRatePerKwh } from './db';
import fs from 'fs';
import path from 'path';

// ─── Tool Metadata (for UI display) ─────────────────────────────────────────

export interface McpToolInfo {
  name: string;
  title: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function getToolInfoList(): McpToolInfo[] {
  return [
    {
      name: 'add_reading',
      title: '添加读数',
      description: '记录一条电表读数。系统自动计算与前一条读数的用电量差值。读数必须按时间递增，不能小于前一条读数，也不能大于后一条读数。如果是数据库中的第一条读数，会使用设置中的初始读数作为基准。',
      parameters: {
        type: 'object',
        properties: {
          reading_value: { type: 'number', description: '电表当前读数（整数或小数）' },
          reading_date: { type: 'string', description: '读数日期，格式 YYYY-MM-DD' },
          notes: { type: 'string', description: '可选备注信息' },
        },
        required: ['reading_value', 'reading_date'],
      },
    },
    {
      name: 'list_readings',
      title: '获取读数',
      description: '查询电表读数记录。支持按日期范围筛选，返回指定范围内的所有读数记录，包含每次读数的用电量。数据按日期降序排列（最新在前）。',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: '开始日期 YYYY-MM-DD' },
          end_date: { type: 'string', description: '结束日期 YYYY-MM-DD' },
          limit: { type: 'number', description: '返回记录数量上限' },
        },
      },
    },
    {
      name: 'get_stats',
      title: '用电统计',
      description: '获取电表的用电统计概览，包括总读数次数、总用电量、总费用、本月用电量和本月费用。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'export_readings',
      title: '导出数据',
      description: '将电表读数数据导出为结构化数据，返回所有读数记录。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: '导出类型，目前仅支持 "readings"' },
        },
        required: ['type'],
      },
    },
    {
      name: 'backup_database',
      title: '备份数据库',
      description: '创建当前数据库的完整备份文件，存储在服务器 data/backups 目录下。',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_settings',
      title: '获取设置',
      description: '获取系统配置信息，包括电价费率和初始读数等设置。',
      parameters: { type: 'object', properties: {} },
    },
  ];
}

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
    version: '1.2.0',
  });

  // ── 添加读数 ──────────────────────────────────────────────────────────
  server.registerTool('add_reading', {
    title: '添加读数',
    description: '记录一条电表读数。系统自动计算用电量。读数必须按时间递增，不能小于前一条读数，也不能大于后一条读数。',
    inputSchema: {
      reading_value: z.number().describe('电表当前读数'),
      reading_date: z.string().describe('读数日期，格式 YYYY-MM-DD'),
      notes: z.string().optional().describe('可选备注信息'),
    },
  }, async (args) => {
    try {
      const db = getDb();
      const { reading_value, reading_date, notes } = args;

      const prevReading = db.prepare(
        'SELECT reading_value FROM readings WHERE reading_date < ? ORDER BY reading_date DESC LIMIT 1'
      ).get(reading_date) as { reading_value: number } | undefined;

      const nextReading = db.prepare(
        'SELECT reading_value FROM readings WHERE reading_date > ? ORDER BY reading_date ASC LIMIT 1'
      ).get(reading_date) as { reading_value: number } | undefined;

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
        INSERT INTO readings (id, reading_value, reading_date, previous_reading, notes, source, created_by)
        VALUES (?, ?, ?, ?, ?, 'mcp', 'ai')
      `).run(id, reading_value, reading_date, previous_reading, notes || null);

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
      query += ' ORDER BY reading_date DESC';
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
      const data = db.prepare('SELECT * FROM readings ORDER BY reading_date DESC').all();
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
