/**
 * settings 表里**允许外发**的 key 白名单。
 *
 * settings 是通用的 key-value 表，凭据和普通配置混在一起。任何「把整表返回出去」
 * 的出口都必须先过这里 —— 否则密码哈希会跟着电价、初始读数一起发给调用方：
 *   · src/lib/mcp-server.ts 的 get_settings 工具（MCP 客户端可见）
 *   · src/app/api/settings/route.ts 的 GET / PUT（登录会话可见）
 *
 * ── 为什么是白名单（这里推翻了早期的选择）─────────────────────────────
 * 早期用的是黑名单（列出敏感的、其余放行），理由是「以后加普通配置项时白名单容易
 * 漏，会把新配置静默吞掉」。那个顾虑本身成立，但漏配的后果不对称：
 *
 *   · 白名单漏一个新配置项 → 设置存了读不到  —— **响的**：一测就发现，而且可回滚
 *   · 黑名单漏一个凭据项   → 凭据静默外发    —— **静的**：没人知道，且不可撤回
 *
 * 安全默认要 fail closed，所以宁可承担「漏配导致设置读不出来」这个可见故障。
 * 上面两句就是当初选黑名单的理由，留在这里是为了说明为什么翻过来 —— 别再翻回去。
 *
 * ── 维护须知 ────────────────────────────────────────────────────────
 * 新增**可公开**的设置项时必须同时加进 PUBLIC_SETTING_KEYS，否则 GET /api/settings
 * 和 MCP 的 get_settings 都不会返回它，前端表现成「设置存了但读不到」。
 *
 * 全仓库写 settings 的 key 目前只有 6 个：
 *   · rate_per_kwh          —— 电价费率（src/lib/db.ts 初始化）
 *   · initial_reading       —— 初始读数（src/lib/db.ts 初始化）
 *   · auth_password         —— bcrypt 密码哈希（src/lib/auth.ts:65）
 *   · mcp_key_hash          —— MCP 密钥的 SHA-256（src/lib/mcp-key.ts:57）
 *   · mcp_key_created_at    —— 密钥生成时间（src/lib/mcp-key.ts:58）
 *   · mcp_key_last_used_at  —— 密钥最后使用时间（src/lib/mcp-key.ts:91）
 * 前两个在白名单里，后四个不在 —— 不在白名单 = 不外发。
 *
 * 注意：不外发不代表不能通过 settings 表读写。密码改由 PUT /api/auth/password 维护，
 * MCP 密钥由 /api/mcp/key 维护。
 */
export const PUBLIC_SETTING_KEYS: ReadonlySet<string> = new Set([
  'rate_per_kwh',
  'initial_reading',
]);

export function isPublicSettingKey(key: string): boolean {
  return PUBLIC_SETTING_KEYS.has(key);
}

/** 只保留白名单里的项，返回可安全外发的 key → value 映射 */
export function toPublicSettings(
  rows: readonly { key: string; value: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!isPublicSettingKey(row.key)) continue;
    out[row.key] = row.value;
  }
  return out;
}
