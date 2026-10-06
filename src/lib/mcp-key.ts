import crypto from 'crypto';
import { deleteSetting, getSetting, setSetting } from './db';

/**
 * MCP 独立密钥。
 *
 * 原来 MCP 客户端用的是登录会话的 JWT —— 那不是密钥，是会话凭证：每次登录都换
 * 一个、签发出去就收不回来、权限和网页端一模一样。这里改成独立密钥：
 *
 *  · 与登录会话完全分开，网页登出、改密码都不影响它；
 *  · 只存 SHA-256 哈希，明文只在生成那一次返回，之后服务端自己也拿不回来；
 *  · 「重新生成」即刻作废旧密钥 —— 这是无状态 JWT 做不到的。
 *
 * 为什么用 SHA-256 而不是 bcrypt：密钥是 32 字节随机数，没有字典可猜，慢哈希在
 * 这里只会让每个 MCP 请求都多花几十毫秒，换不来实际强度。
 */

const HASH_KEY = 'mcp_key_hash';
const CREATED_KEY = 'mcp_key_created_at';
const USED_KEY = 'mcp_key_last_used_at';

/** 前缀便于识别，也便于泄露扫描工具认出这是哪家的密钥 */
const PREFIX = 'elecmcp_';

/** 最后使用时间的写入节流：MCP 请求可能很密，没必要每次都写库 */
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface McpKeyStatus {
  configured: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** db.ts 的 getSetting 返回 undefined，这里统一成 null，调用方判断更直接 */
function readSetting(key: string): string | null {
  return getSetting(key) ?? null;
}

/** 密钥状态。**不含密钥本身** —— 库里只有哈希，没有可返回的明文。 */
export function getMcpKeyStatus(): McpKeyStatus {
  const hash = readSetting(HASH_KEY);
  if (!hash) return { configured: false, createdAt: null, lastUsedAt: null };
  return {
    configured: true,
    createdAt: readSetting(CREATED_KEY),
    lastUsedAt: readSetting(USED_KEY),
  };
}

/** 生成新密钥并返回明文（**只有这一次**）。旧密钥立刻失效。 */
export function generateMcpKey(): string {
  const key = PREFIX + crypto.randomBytes(32).toString('base64url');
  setSetting(HASH_KEY, sha256(key));
  setSetting(CREATED_KEY, new Date().toISOString());
  deleteSetting(USED_KEY);
  return key;
}

/** 吊销：删掉哈希，之后任何 MCP 密钥都不认。 */
export function revokeMcpKey() {
  deleteSetting(HASH_KEY);
  deleteSetting(CREATED_KEY);
  deleteSetting(USED_KEY);
}

/**
 * 校验密钥。
 *
 * 先比哈希再定长比较：直接比字符串会因为提前返回而泄露前缀信息，虽然这里
 * 攻击者拿不到响应时间的高精度样本，但定长比较是一行的事，没有理由不做。
 */
export function verifyMcpKey(candidate: string): boolean {
  const stored = readSetting(HASH_KEY);
  if (!stored) return false;

  const a = Buffer.from(sha256(candidate), 'hex');
  const b = Buffer.from(stored, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 记录最后一次使用时间，供管理界面显示。60 秒内不重复写。 */
export function touchMcpKey() {
  const last = readSetting(USED_KEY);
  const now = Date.now();
  if (last && now - Date.parse(last) < TOUCH_INTERVAL_MS) return;
  setSetting(USED_KEY, new Date(now).toISOString());
}
