/**
 * 展示格式化 —— 纯函数，不依赖 React。
 *
 * 集中在一处的原因：`toFixed(1)` 散落在各页面里时，"用电量保留几位"这件事
 * 会有五种写法（1 位、2 位、不保留），同一个数字在仪表盘和统计页显示成两个值。
 */

/** 千分位 + 固定小数位。NaN / null 一律显示 "-"，不显示 "NaN" */
export function fmtNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 用电量：统一 1 位小数 */
export function fmtKwh(value: number | null | undefined): string {
  return fmtNumber(value, 1);
}

/** 金额：统一 2 位小数，带 ¥ */
export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `¥${fmtNumber(value, 2)}`;
}

/** 时间戳 / ISO 串 → `2026-10-06 12:30`，本地时区 */
export function fmtDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 文件体积 */
export function fmtSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 今天的 `YYYY-MM-DD`（本地时区，不用 toISOString —— 那是 UTC） */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 某个 `YYYY-MM-DD` 往前推 N 个月的 `YYYY-MM-DD` */
export function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setMonth(d.getMonth() - months);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** N 个月前的 `YYYY-MM-DD`（相对今天） */
export function monthsAgo(months: number): string {
  return monthsBefore(today(), months);
}
