import { getDb, generateId, getRatePerKwh } from './db';
import { Reading } from '@/types';

interface McpTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  returns: Record<string, string>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

const tools: McpTool[] = [
  {
    name: '添加读数',
    description: '记录一条电表读数。系统会自动计算与前一条读数的用电量差值。读数必须按时间递增，不能小于前一条读数，也不能大于后一条读数。如果是数据库中的第一条读数，会使用设置中的初始读数作为基准。',
    parameters: {
      type: 'object',
      properties: {
        reading_value: { type: 'number', description: '电表当前读数（整数或小数）' },
        reading_date: { type: 'string', description: '读数日期，格式 YYYY-MM-DD' },
        notes: { type: 'string', description: '可选备注信息' },
      },
      required: ['reading_value', 'reading_date'],
    },
    returns: {
      id: '记录ID',
      reading_value: '表读数',
      reading_date: '读数日期',
      previous_reading: '前一次读数',
      units_consumed: '本次用电量（自动计算）',
      notes: '备注',
      source: '数据来源（mcp）',
      created_at: '创建时间',
    },
    handler: async (params) => {
      const db = getDb();
      const { reading_value, reading_date, notes } = params;

      const prevReading = db.prepare(
        'SELECT reading_value FROM readings WHERE reading_date < ? ORDER BY reading_date DESC LIMIT 1'
      ).get(reading_date) as { reading_value: number } | undefined;

      const nextReading = db.prepare(
        'SELECT reading_value FROM readings WHERE reading_date > ? ORDER BY reading_date ASC LIMIT 1'
      ).get(reading_date) as { reading_value: number } | undefined;

      if (prevReading && (reading_value as number) < prevReading.reading_value) {
        throw new Error(`读数不能小于前一次读数 (${prevReading.reading_value})`);
      }

      if (nextReading && (reading_value as number) > nextReading.reading_value) {
        throw new Error(`读数不能大于后一次读数 (${nextReading.reading_value})`);
      }

      let previous_reading = prevReading?.reading_value ?? null;

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

      return newReading;
    },
  },
  {
    name: '获取读数',
    description: '查询电表读数记录。支持按日期范围筛选，返回指定范围内的所有读数记录，包含每次读数的用电量。数据按日期降序排列（最新在前）。',
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: '开始日期，格式 YYYY-MM-DD，返回此日期及之后的记录' },
        end_date: { type: 'string', description: '结束日期，格式 YYYY-MM-DD，返回此日期及之前的记录' },
        limit: { type: 'number', description: '返回记录数量上限，不设置则返回全部' },
      },
    },
    returns: {
      'Reading[]': '读数记录数组，每条包含 id, reading_value, reading_date, previous_reading, units_consumed, notes, source, created_at',
    },
    handler: async (params) => {
      const db = getDb();
      const { start_date, end_date, limit } = params;

      let query = 'SELECT * FROM readings WHERE 1=1';
      const queryParams: unknown[] = [];

      if (start_date) {
        query += ' AND reading_date >= ?';
        queryParams.push(start_date);
      }
      if (end_date) {
        query += ' AND reading_date <= ?';
        queryParams.push(end_date);
      }

      query += ' ORDER BY reading_date DESC';

      if (limit) {
        query += ' LIMIT ?';
        queryParams.push(limit);
      }

      return db.prepare(query).all(...queryParams);
    },
  },
  {
    name: '用电统计',
    description: '获取电表的用电统计概览，包括总读数次数、总用电量、总费用、本月用电量和本月费用。用于快速了解用电情况。',
    parameters: {
      type: 'object',
      properties: {},
    },
    returns: {
      totalReadings: '总读数记录数',
      totalConsumed: '累计总用电量（度）',
      totalAmount: '累计总费用（元）',
      currentMonthConsumed: '本月用电量（度）',
      currentMonthAmount: '本月费用（元）',
    },
    handler: async () => {
      const db = getDb();

      const totalReadings = (db.prepare('SELECT COUNT(*) as count FROM readings').get() as { count: number }).count;
      const totalConsumed = (db.prepare('SELECT COALESCE(SUM(units_consumed), 0) as total FROM readings').get() as { total: number }).total;

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const currentMonthConsumed = (db.prepare(`
        SELECT COALESCE(SUM(units_consumed), 0) as total FROM readings
        WHERE reading_date LIKE ? || '%'
      `).get(currentMonth) as { total: number }).total;

      const ratePerKwh = getRatePerKwh();
      const currentMonthAmount = currentMonthConsumed * ratePerKwh;
      const totalAmount = totalConsumed * ratePerKwh;

      return {
        totalReadings,
        totalConsumed,
        totalAmount,
        currentMonthConsumed,
        currentMonthAmount,
      };
    },
  },
  {
    name: '导出数据',
    description: '将电表读数数据导出为结构化数据。目前支持导出读数记录。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '导出类型，目前仅支持 "readings"' },
      },
      required: ['type'],
    },
    returns: {
      count: '导出记录数',
      data: '数据数组',
    },
    handler: async (params) => {
      const db = getDb();
      const { type } = params;

      let data: Record<string, unknown>[];
      if (type === 'readings') {
        data = db.prepare('SELECT * FROM readings ORDER BY reading_date DESC').all() as Record<string, unknown>[];
      } else {
        throw new Error('无效的导出类型');
      }

      return { count: data.length, data };
    },
  },
  {
    name: '备份数据库',
    description: '创建当前数据库的完整备份文件。备份文件存储在服务器的 data/backups 目录下。',
    parameters: {
      type: 'object',
      properties: {},
    },
    returns: {
      message: '操作结果消息',
      fileName: '备份文件名',
    },
    handler: async () => {
      const db = getDb();
      const fs = await import('fs');
      const path = await import('path');

      const backupDir = path.join(process.cwd(), 'data', 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `elec-backup-${timestamp}.db`;
      const backupPath = path.join(backupDir, fileName);

      await db.backup(backupPath);

      return { message: '备份成功', fileName };
    },
  },
  {
    name: '获取设置',
    description: '获取系统配置信息，包括电价费率和初始读数等设置。',
    parameters: {
      type: 'object',
      properties: {},
    },
    returns: {
      rate_per_kwh: '每度电价（元）',
      initial_reading: '电表初始读数',
    },
    handler: async () => {
      const db = getDb();
      const settings = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
      const result: Record<string, string> = {};
      settings.forEach(s => { result[s.key] = s.value; });
      return result;
    },
  },
];

export function getMcpTools() {
  return tools.map(({ name, description, parameters, returns }) => ({
    name,
    description,
    inputSchema: parameters,
    returns,
  }));
}

export async function callMcpTool(name: string, params: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`未找到工具: ${name}`);
  }
  return tool.handler(params);
}
