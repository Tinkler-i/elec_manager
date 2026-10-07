export interface Reading {
  id: string;
  reading_value: number;
  reading_date: string;
  reading_time: string | null;
  previous_reading: number | null;
  units_consumed: number;
  notes: string | null;
  source: 'manual' | 'mcp' | 'import';
  created_by: string;
  is_verified: boolean;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

/** GET /api/settings 的返回：key → value（已排除 auth_password） */
export type SettingsMap = Record<string, string>;

export interface Stats {
  totalReadings: number;
  totalConsumed: number;
  totalAmount: number;
  currentMonthConsumed: number;
  currentMonthAmount: number;
}

export interface BackupFile {
  name: string;
  size: number;
  /** 后端给的是 fs.Stats.birthtime，JSON 化后是 ISO 字符串 */
  created: string;
}

export interface McpToolInfo {
  name: string;
  title: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/**
 * 一把 MCP 密钥的元信息。
 *
 * **不含密钥本身** —— 库里只存 SHA-256 哈希，生成之后服务端也拿不回明文。
 * 所以界面上的「管理」只能是看列表 + 改备注 + 吊销，不能是「查看密钥」。
 */
export interface McpKeyInfo {
  id: string;
  /** 备注。后端会 trim，空串按 null 存 */
  note: string | null;
  createdAt: string;
  /** 从没用过就是 null */
  lastUsedAt: string | null;
}

/**
 * 新建密钥的响应。
 *
 * `key` 是明文，**只在这一个响应里出现一次** —— 之后库里只有哈希，
 * 刷新页面也拿不回来。别把它存进任何会持久化的地方。
 */
export interface McpKeyCreated {
  key: string;
  info: McpKeyInfo;
}

/** 新建/编辑读数时提交的载荷 */
export interface ReadingInput {
  reading_value: number;
  reading_date: string;
  reading_time: string | null;
  notes: string | null;
}

/**
 * 更新检查结果。
 *
 * `error` 有值时 `latest` / `hasUpdate` 都不可信 —— 「查不到有没有新版」和
 * 「确认没有新版」是两件事，界面上不能都显示成「已是最新」。
 */
export interface UpdateInfo {
  /** 当前运行版本（飞牛下取自 TRIM_APPVER） */
  current: string;
  /** 最新 Release 的 tag，形如 v1.9.2 */
  latest: string | null;
  hasUpdate: boolean;
  /** Release 页面地址，供用户手动下载 */
  releaseUrl: string;
  publishedAt: string | null;
  /** 更新说明（截断过） */
  notes: string | null;
  checkedAt: string;
  /** 本次结果是否来自服务端缓存 */
  cached: boolean;
  error: string | null;
}
