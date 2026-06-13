// ─── MCP Tool Metadata (独立文件，不依赖 @modelcontextprotocol/sdk) ────────

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
