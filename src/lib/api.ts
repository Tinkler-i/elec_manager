import type {
  BackupFile,
  McpKeyCreated,
  McpKeyInfo,
  McpToolInfo,
  Reading,
  ReadingInput,
  SettingsMap,
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

/** 单次请求的附加行为 */
interface RequestOptions {
  /**
   * 401 是否按「会话失效」处理（跳登录页 + 统一文案），默认是。
   *
   * 登录接口必须关掉：它的 401 含义是「密码错误」。被改写成「登录已失效，请重新
   * 登录」之后，用户看到的提示和实际发生的事对不上，排查时会被带偏。
   */
  sessionExpiry?: boolean;
}

async function request<T>(url: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    // 网络层失败（断网、请求被取消）：不是业务错误，文案要说清是"没连上"
    throw new ApiError("网络连接失败，请检查服务是否在运行", 0);
  }

  if (response.status === 401 && options.sessionExpiry !== false && typeof window !== "undefined") {
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
  // sessionExpiry: false —— 这里的 401 是「密码错误」，要原样透给用户
  login: (password: string, remember: boolean) =>
    request<{ ok: boolean }>("/api/auth/login", jsonInit("POST", { password, remember }), {
      sessionExpiry: false,
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", jsonInit("POST")),
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

  /**
   * 密钥列表。后端已按创建时间倒序排好。
   *
   * 返回值多做一道运行时形状校验，因为 `request<T>` 只是类型断言、不做校验：
   *
   * - **什么情况下会不成立**：后端还是单把形态的旧版本时，`GET /api/mcp/key`
   *   返回 `{configured, createdAt, lastUsedAt}` —— HTTP 200、没有错误。
   *   这时 `data.keys` 是 `undefined`，而 `tsc` 全绿：类型系统在这里帮不上忙。
   * - **不成立时界面会怎么骗人**：`values.keys?.keys ?? []` 得到空数组，页面
   *   显示「还没有独立密钥」这个空态。密钥其实还在库里，界面却告诉用户一把都
   *   没有 —— 他会以为密钥丢了，甚至重新生成，把在用的客户端全部踢下线。
   *
   * 所以宁可抛错：页面会走「密钥列表没取到」那一行 + 重试，是诚实的失败。
   *
   * 只在 listKeys 上加：别的接口没有「形状错了会伪装成空态」这个问题。要扩到
   * 全仓得先想清楚哪些返回值真需要校验、校验失败怎么表达，那是另一个话题。
   */
  listKeys: () =>
    request<{ keys: McpKeyInfo[] }>("/api/mcp/key").then((data) => {
      if (!Array.isArray(data?.keys)) {
        throw new Error("服务端返回的密钥列表格式不对（后端可能还是旧版本），请升级后重试");
      }
      return data;
    }),

  /**
   * 新建一把密钥。
   *
   * 明文只在这次响应里出现一次（库里只存 SHA-256），之后再也拿不回来。
   * 备注留空就不带这个字段 —— 后端兼容空 body，会按 null 存。
   */
  createKey: (note?: string) =>
    request<McpKeyCreated>("/api/mcp/key", jsonInit("POST", note ? { note } : undefined)),

  /**
   * 改备注。
   *
   * `note` **必须显式给出**：后端缺这个字段会返 400，不会当成「清空」。
   * 要清空就传 `null`，不要传 `undefined`。
   */
  updateKeyNote: (id: string, note: string | null) =>
    request<{ info: McpKeyInfo }>("/api/mcp/key", jsonInit("PATCH", { id, note })),

  /** 吊销指定的一把 */
  revokeKey: (id: string) =>
    request<{ ok: boolean; revoked: number }>(
      `/api/mcp/key?id=${encodeURIComponent(id)}`,
      jsonInit("DELETE"),
    ),

  /** 吊销全部。返回实际吊销了几把 */
  revokeAllKeys: () =>
    request<{ ok: boolean; revoked: number }>("/api/mcp/key", jsonInit("DELETE")),
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
