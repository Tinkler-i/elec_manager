/**
 * settings 表里不能外发的 key。
 *
 * settings 是通用的 key-value 表，凭据和普通配置混在一起。任何「把整表返回出去」
 * 的出口都必须先过这里 —— 否则密码哈希会跟着电价、初始读数一起发给调用方：
 *   · src/lib/mcp-server.ts 的 get_settings 工具（MCP 客户端可见）
 *   · src/app/api/settings/route.ts 的 GET / PUT（登录会话可见）
 *
 * 用黑名单而不是白名单：settings 表以后会继续加普通配置项，白名单一旦忘了同步
 * 就会把新配置静默吞掉，前端表现成「设置存了但读不到」；而凭据项是少数，写入点
 * 集中在下面三处，漏一个在评审时能看出来。
 *
 *   · auth_password         —— bcrypt 密码哈希（src/lib/auth.ts:63）
 *   · mcp_key_hash          —— MCP 密钥的 SHA-256（src/lib/mcp-key.ts:72）
 *   · mcp_key_created_at    —— 密钥生成时间（src/lib/mcp-key.ts:73）
 *   · mcp_key_last_used_at  —— 密钥最后使用时间（src/lib/mcp-key.ts:106）
 *
 * 注意：这里只是不外发，不代表这些 key 不能通过 settings 表读写。密码改由
 * PUT /api/auth/password 维护，MCP 密钥由 /api/mcp/key 维护。
 */
export const SENSITIVE_SETTING_KEYS: ReadonlySet<string> = new Set([
  'auth_password',
  'mcp_key_hash',
  'mcp_key_created_at',
  'mcp_key_last_used_at',
]);

export function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_KEYS.has(key);
}

/** 过滤掉敏感项，返回可安全外发的 key → value 映射 */
export function toPublicSettings(
  rows: readonly { key: string; value: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (isSensitiveSettingKey(row.key)) continue;
    out[row.key] = row.value;
  }
  return out;
}
