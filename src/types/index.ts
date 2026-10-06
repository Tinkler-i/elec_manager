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
