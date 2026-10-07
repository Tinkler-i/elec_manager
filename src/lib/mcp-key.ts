import crypto from 'crypto';
import { generateId, getDb } from './db';
import { MAX_KEYS, MAX_NOTE_LENGTH } from './mcp-key-limits';

/**
 * MCP 独立密钥（2026-10 起支持多把）。
 *
 * 原来 MCP 客户端用的是登录会话的 JWT —— 那不是密钥，是会话凭证：每次登录都换
 * 一个、签发出去就收不回来、权限和网页端一模一样。所以改成独立密钥。
 *
 * 多把的动机：一把密钥只能是一个「身份」。给手机配一把、给家里电脑配一把、给
 * Claude Desktop 配一把，任何一把要换就得全体重配。现在每把带备注、可以单独吊销。
 *
 * 不变的三条：
 *  · 与登录会话完全分开，网页登出、改密码都不影响它；
 *  · 只存 SHA-256 哈希，明文只在生成那一次返回，之后服务端自己也拿不回来；
 *  · 吊销即刻生效 —— 这是无状态 JWT 做不到的。
 *
 * 为什么用 SHA-256 而不是 bcrypt：密钥是 32 字节随机数，没有字典可猜，慢哈希在
 * 这里只会让每个 MCP 请求都多花几十毫秒，换不来实际强度。
 *
 * 存储：独立的 `mcp_keys` 表（不塞进 settings）—— settings 是通用 key-value，
 * 一把密钥原来要占三个 key，多把之后会变成三的倍数，没法按行改备注也没法约束上限。
 * 旧数据由 db.ts 的 migrateLegacyMcpKey 在启动时迁进来。
 */

/** 前缀便于识别，也便于泄露扫描工具认出这是哪家的密钥 */
const PREFIX = 'elecmcp_';

/** 最后使用时间的写入节流：MCP 请求可能很密，没必要每次都写库 */
const TOUCH_INTERVAL_MS = 60 * 1000;

/** 客户端输入不合法（备注超长、超出上限）。路由据此转 400，不要当成 500。 */
export class McpKeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpKeyValidationError';
  }
}

export interface McpKeyInfo {
  id: string;
  note: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface McpKeyRow {
  id: string;
  hash: string;
  note: string | null;
  created_at: string;
  last_used_at: string | null;
}

function toInfo(row: McpKeyRow): McpKeyInfo {
  return {
    id: row.id,
    note: row.note,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * 按**字素簇**（用户眼里的「一个字符」）数长度。
 *
 * 为什么不能用 `String.length`：它数的是 **UTF-16 码元**，不是字符。
 *   · `😀` 用户看是 1 个字符，`'😀'.length === 2`
 *   · `🧑‍🚀`（ZWJ 序列）用户看是 1 个字符，`length === 5`
 * 用码元数就会把「64 个 emoji」算成 128 而拒绝，偏偏错误信息还写着「最长 64 个字符」——
 * 用户数出来正好 64，系统说超了，**那句话是假的**。实测（task-46）：
 *   `😀`×64 → 400、`😀`×32 → 201、`🧑‍🚀`×63 → 400、64 个汉字 → 201。
 * 所以这里必须按字素簇数。`Intl.Segmenter` 在 Node 18+ 与现代浏览器都有。
 * **别把它「简化」回 `String.length`** —— 那会让错误信息重新变成假的。
 *
 * ⚠️ **但这个计数不保证跨引擎一致**，别把它当成「前后端同一个算法」：
 * QA 实测 Node 与 Chromium 的分段有差异（37,928 条里 2,456 条不同，最小复现
 * `🗩\u200D🗩`：Node=1、Chromium=2），机制是两侧对 `Extended_Pictographic` 的判定
 * 不同 → GB11 规则是否适用不同。**方向是前端更严**（误拦，不是放行），
 * 但**只测了 Chromium，Firefox / Safari 未验，方向可能相反**。
 * 结论：前端那道 gate 是**提示**不是保证，**真正的判定在这个后端函数**。
 */
const graphemeSegmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });

function graphemeLength(value: string): number {
  return [...graphemeSegmenter.segment(value)].length;
}

/** 备注规范化：去首尾空白、空串按「没有备注」存 null、超长抛错。 */
function normalizeNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const trimmed = note.trim();
  if (trimmed.length === 0) return null;
  // 长度按字素簇判（见 graphemeLength 的注释），这样「64 个字符」这句才是真的
  if (graphemeLength(trimmed) > MAX_NOTE_LENGTH) {
    throw new McpKeyValidationError(`备注最长 ${MAX_NOTE_LENGTH} 个字符`);
  }
  return trimmed;
}

/** 全部密钥，按创建时间倒序。**不含 hash** —— 外发结构里不能出现任何密钥材料。 */
export function listMcpKeys(): McpKeyInfo[] {
  const rows = getDb()
    .prepare('SELECT id, hash, note, created_at, last_used_at FROM mcp_keys ORDER BY created_at DESC')
    .all() as McpKeyRow[];
  return rows.map(toInfo);
}

function getMcpKeyById(id: string): McpKeyInfo | null {
  const row = getDb()
    .prepare('SELECT id, hash, note, created_at, last_used_at FROM mcp_keys WHERE id = ?')
    .get(id) as McpKeyRow | undefined;
  return row ? toInfo(row) : null;
}

/**
 * 生成新密钥并返回明文（**对这把密钥而言只有这一次**）。
 *
 * 不再覆盖旧密钥 —— 这是本文件这次改动前最主要的行为变化。要清理请显式调
 * revokeMcpKey / revokeAllMcpKeys。
 */
export function createMcpKey(note?: string | null): { key: string; info: McpKeyInfo } {
  const normalized = normalizeNote(note);
  const db = getDb();

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM mcp_keys').get() as { n: number };
  if (n >= MAX_KEYS) {
    throw new McpKeyValidationError(`最多只能有 ${MAX_KEYS} 把密钥，请先吊销不用的`);
  }

  const key = PREFIX + crypto.randomBytes(32).toString('base64url');
  const info: McpKeyInfo = {
    id: generateId(),
    note: normalized,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };

  db.prepare(
    'INSERT INTO mcp_keys (id, hash, note, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)'
  ).run(info.id, sha256(key), info.note, info.createdAt, info.lastUsedAt);

  return { key, info };
}

/** 改备注（null / 空串 = 清掉备注）。不存在返回 null。 */
export function updateMcpKeyNote(id: string, note: string | null): McpKeyInfo | null {
  const normalized = normalizeNote(note);
  const result = getDb().prepare('UPDATE mcp_keys SET note = ? WHERE id = ?').run(normalized, id);
  if (result.changes === 0) return null;
  return getMcpKeyById(id);
}

/** 吊销一把。返回是否真的删掉了（false = id 不存在）。 */
export function revokeMcpKey(id: string): boolean {
  return getDb().prepare('DELETE FROM mcp_keys WHERE id = ?').run(id).changes > 0;
}

/** 吊销全部，返回吊销数量。 */
export function revokeAllMcpKeys(): number {
  return getDb().prepare('DELETE FROM mcp_keys').run().changes;
}

/**
 * 校验密钥，命中则返回那一把的信息（**不含 hash**），否则 null。
 *
 * 先比哈希再定长比较：直接比字符串会因为提前返回而泄露前缀信息。
 *
 * ⚠️ **必须遍历全部，不能 `if (match) return ...` 提前返回。**
 * 多把之后，提前返回会让响应时间随「命中第几把」变化 —— 攻击者能从耗时把
 * 「没命中 / 命中第 1 把 / 命中第 3 把」区分出来，等于把密钥在列表里的位置漏出去。
 * 这里改成遍历到底、只用变量累积结果，比较耗时与命中位置无关。
 * （返回值的构造放在循环之后，同样是为了不在循环里分叉。）
 */
export function verifyMcpKey(candidate: string): McpKeyInfo | null {
  const rows = getDb()
    .prepare('SELECT id, hash, note, created_at, last_used_at FROM mcp_keys')
    .all() as McpKeyRow[];

  const candidateDigest = Buffer.from(sha256(candidate), 'hex');

  let matched: McpKeyRow | null = null;
  for (const row of rows) {
    const stored = Buffer.from(row.hash, 'hex');
    const same =
      stored.length === candidateDigest.length && crypto.timingSafeEqual(candidateDigest, stored);
    if (same) matched = row;
  }

  return matched ? toInfo(matched) : null;
}

/**
 * 记录某一把的最后使用时间，供管理界面显示。60 秒内不重复写。
 *
 * 参数是 `verifyMcpKey` 返回的那把的 id —— 多把之后必须知道命中的是哪一把，
 * 不能再写「唯一的那把」。
 */
export function touchMcpKey(id: string): void {
  const db = getDb();
  const row = db.prepare('SELECT last_used_at FROM mcp_keys WHERE id = ?').get(id) as
    | { last_used_at: string | null }
    | undefined;
  if (!row) return;

  const now = Date.now();
  if (row.last_used_at && now - Date.parse(row.last_used_at) < TOUCH_INTERVAL_MS) return;

  db.prepare('UPDATE mcp_keys SET last_used_at = ? WHERE id = ?').run(
    new Date(now).toISOString(),
    id,
  );
}
