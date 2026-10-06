import type {
  BackupFile,
  McpToolInfo,
  Reading,
  ReadingInput,
  SettingsMap,
  Stats,
  UpdateInfo,
} from "@/types";

/**
 * 统一的接口层。
 *
 * 原来每个页面各自 `fetch` + `response.json()`，于是同一件事写了五遍，而且
 * 各自漏掉同一批东西：非 2xx 不抛错（`await response.json()` 拿到的是
 * `{error}`，被当成正常数据往下传）、失败只 `console.error`、401 不统一处理。
 * 这里收成一处：非 2xx 一律抛 ApiError，错误文案统一走 errText()。
 */

/** 带状态码的错误，调用方需要区分 401/403 时用得上 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    // 网络层失败（断网、请求被取消）：不是业务错误，文案要说清是"没连上"
    throw new ApiError("网络连接失败，请检查服务是否在运行", 0);
  }

  if (response.status === 401 && typeof window !== "undefined") {
    // 会话失效：交给页面跳登录。这里不直接跳，避免在登录页自己踢自己
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    throw new ApiError("登录已失效，请重新登录", 401);
  }

  if (!response.ok) {
    throw new ApiError(await extractError(response), response.status);
  }

  // 204 / 空响应体：没有 JSON 可解析
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** 后端统一用 `{error: "..."}` 报错；拿不到就退回状态码描述 */
async function extractError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text) {
      const data = JSON.parse(text) as { error?: string };
      if (data?.error) return data.error;
    }
  } catch {
    /* 响应体不是 JSON：走下面的兜底 */
  }
  return `请求失败（HTTP ${response.status}）`;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/**
 * 把任意异常转成可展示的文案。
 *
 * ApiError 的 message 已经是后端给的中文原文（"读数不能小于前一次读数 (1234)"），
 * 直接透传比换成"操作失败"有用得多 —— 用户能照着改。
 */
export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "操作失败";
}

/* ── 鉴权 ───────────────────────────────────────────── */

export const authApi = {
  check: () => request<{ authenticated: boolean }>("/api/auth/check"),
  login: (password: string, remember: boolean) =>
    request<{ ok: boolean }>("/api/auth/login", jsonInit("POST", { password, remember })),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", jsonInit("POST")),
  token: () => request<{ token: string }>("/api/auth/token"),
  changePassword: (password: string) =>
    request<{ ok: boolean }>("/api/auth/password", jsonInit("PUT", { password })),
};

/* ── 读数 ───────────────────────────────────────────── */

export const readingsApi = {
  list: () => request<Reading[]>("/api/readings"),
  create: (input: ReadingInput) => request<Reading>("/api/readings", jsonInit("POST", input)),
  update: (id: string, input: ReadingInput) =>
    request<Reading>(`/api/readings/${encodeURIComponent(id)}`, jsonInit("PUT", input)),
  remove: (id: string) =>
    request<{ success?: boolean }>(`/api/readings/${encodeURIComponent(id)}`, jsonInit("DELETE")),
  removeMany: (ids: string[]) =>
    request<{ deleted: number }>("/api/readings/batch-delete", jsonInit("POST", { ids })),
  recalculate: () =>
    request<{ message: string; initialReading?: number }>("/api/readings/recalculate", jsonInit("POST")),
};

/* ── 设置 / 统计 / 备份 ─────────────────────────────── */

export const settingsApi = {
  get: () => request<SettingsMap>("/api/settings"),
  update: (patch: SettingsMap) => request<SettingsMap>("/api/settings", jsonInit("PUT", patch)),
};

export const statsApi = {
  get: () => request<Stats>("/api/stats"),
};

export const backupApi = {
  list: () => request<BackupFile[]>("/api/backup"),
  create: () => request<{ message: string; fileName: string }>("/api/backup", jsonInit("POST")),
  remove: (name: string) =>
    request<{ message: string }>(`/api/backup?file=${encodeURIComponent(name)}`, jsonInit("DELETE")),
  removeAll: () => request<{ message: string }>("/api/backup?all=true", jsonInit("DELETE")),
  /** 下载走浏览器原生跳转，不走 fetch（响应是二进制附件） */
  downloadUrl: (name: string) => `/api/backup?file=${encodeURIComponent(name)}`,
};

/* ── MCP ────────────────────────────────────────────── */

export const mcpApi = {
  tools: () => request<{ tools: McpToolInfo[] }>("/api/mcp/tools"),
};

/* ── 更新检查 ───────────────────────────────────────── */

export const updateApi = {
  /**
   * 查有没有新版本。
   *
   * `force` 为 true 时绕过服务端 30 分钟缓存 —— 用户点「检查更新」按钮时用，
   * 页面自动检查时走缓存（GitHub 匿名配额只有 60 次/小时）。
   */
  check: (force = false) => request<UpdateInfo>(`/api/update${force ? "?force=1" : ""}`),
};
