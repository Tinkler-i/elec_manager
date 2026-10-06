import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Reading, Setting, Stats } from '../types';

// 这几处的 /*turbopackIgnore: true*/ 不是装饰。Turbopack 对解析不出的路径会退化成
// 「按模式匹配」，把仓库里匹配上的文件全 trace 进 .next/standalone —— 实测开发机上只要
// 存在 fnos/App.Native.ElecMeter/app/server/（上一次打包的产物），它就会被 trace 进去，
// 于是 fnos/build.sh 第二轮把上一轮的产物嵌进新包。所有路径定义与 fs 调用都要带上这个注释。
// 详见 backupDatabase() 上面那段说明。
//
// export：src/lib/auth.ts 要用它（jwt_secret 文件要放在库同目录）。这里曾经在两处各写
// 一遍同样的 `ELEC_DB_PATH || cwd/data/elec.db`，改一边忘一边就会让密钥文件落到别的目录去。
export const DB_PATH = process.env.ELEC_DB_PATH || path.join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'elec.db');

/**
 * 数据目录：默认跟数据库放在一起。
 *
 * 为什么不按 `process.cwd()` 算：Next standalone 的 `server.js` 一启动就
 * `process.chdir(__dirname)`，cwd 因此永远是**安装目录**。飞牛 fnOS 升级时会把
 * 安装目录整体替换掉，备份写在那里会连数据一起消失；数据库在 TRIM_PKGVAR
 * （重启与升级都保留），备份跟着它才对。
 *
 * Docker 下 ELEC_DB_PATH 未设置，退回 `cwd/data`，正好是 docker-compose 挂的卷。
 */
export const DATA_DIR = process.env.ELEC_DATA_DIR || path.dirname(/*turbopackIgnore: true*/ DB_PATH);

/** 备份目录，可用 `ELEC_BACKUP_DIR` 覆盖（飞牛包显式指向 `TRIM_PKGVAR/backups`） */
export const BACKUP_DIR = process.env.ELEC_BACKUP_DIR || path.join(/*turbopackIgnore: true*/ DATA_DIR, 'backups');

let db: Database.Database | null = null;
let cachedRate: number | null = null;
let cachedInitialReading: number | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000');
    db.pragma('foreign_keys = ON');
    db.pragma('temp_store = MEMORY');
    initializeDb(db);
  }
  return db;
}

function initializeDb(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS readings (
      id TEXT PRIMARY KEY,
      reading_value REAL NOT NULL,
      reading_date TEXT NOT NULL,
      previous_reading REAL,
      units_consumed REAL GENERATED ALWAYS AS (reading_value - COALESCE(previous_reading, 0)) STORED,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'mcp', 'import')),
      created_by TEXT NOT NULL DEFAULT 'user',
      is_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_readings_date ON readings(reading_date);
  `);

  // Migration: add reading_time column if missing
  const columns = db.prepare("PRAGMA table_info(readings)").all() as { name: string }[];
  if (!columns.some(c => c.name === 'reading_time')) {
    db.exec("ALTER TABLE readings ADD COLUMN reading_time TEXT");
  }

  const rateSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('rate_per_kwh');
  if (!rateSetting) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('rate_per_kwh', '0.56');
    cachedRate = 0.56;
  }

  const initialReading = db.prepare('SELECT value FROM settings WHERE key = ?').get('initial_reading');
  if (!initialReading) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('initial_reading', '0');
    cachedInitialReading = 0;
  }
}

export function generateId(): string {
  return uuidv4();
}

export function invalidateSettingsCache() {
  cachedRate = null;
  cachedInitialReading = null;
}

export function getRatePerKwh(): number {
  if (cachedRate !== null) return cachedRate;
  const db = getDb();
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('rate_per_kwh') as { value: string } | undefined;
  cachedRate = setting ? parseFloat(setting.value) : 0.56;
  return cachedRate;
}

export function getInitialReading(): number {
  if (cachedInitialReading !== null) return cachedInitialReading;
  const db = getDb();
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('initial_reading') as { value: string } | undefined;
  cachedInitialReading = setting ? parseFloat(setting.value) : 0;
  return cachedInitialReading;
}

// ─── 设置：读写 ─────────────────────────────────────────────────────────────
//
// settings 是通用的 key-value 表，凭据（auth_password、mcp_key_*）和普通配置
// （rate_per_kwh、initial_reading）混在一起。外发前必须先过 toPublicSettings()。

/** 读一个设置项；不存在返回 undefined */
export function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/**
 * 写一个设置项（不存在则插入，存在则覆盖）。
 *
 * 刻意不在这里自动清设置缓存：touchMcpKey 会周期性写 mcp_key_last_used_at，
 * 自动清缓存会让 getRatePerKwh / getInitialReading 无谓地反复查库。
 * 改了 rate_per_kwh / initial_reading 的调用方要自己调 invalidateSettingsCache()。
 */
export function setSetting(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}

/** 删除一个设置项 */
export function deleteSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}

/** 全部设置项（含 updated_at）。外发前必须先过 toPublicSettings() */
export function getAllSettings(): Setting[] {
  return getDb().prepare('SELECT key, value, updated_at FROM settings').all() as Setting[];
}

// ─── 备份 ───────────────────────────────────────────────────────────────────

/**
 * 把当前数据库完整备份到 BACKUP_DIR，返回生成的文件名。
 *
 * **必须 await**：`better-sqlite3` 的 `db.backup()` 是异步的，真正的页拷贝发生在
 * `setImmediate` 里（见 node_modules/better-sqlite3/lib/methods/backup.js 的
 * runBackup）。不 await 就返回，调用方会拿到「成功」，而文件此刻还没建出来 ——
 * 进程在这几毫秒内挂掉就留下一个空备份，而且失败是静默的。
 *
 * 目录也在这里统一建：HTTP 和 MCP 两条路径共用这一份，不会各写一套再分叉。
 */
export async function backupDatabase(): Promise<string> {
  const db = getDb();

  // ⚠️ 下面三处的 /*turbopackIgnore: true*/ 不是装饰，删掉会炸打包。
  //
  // BACKUP_DIR 是运行期路径（ELEC_BACKUP_DIR，或 process.cwd() 下的默认目录），打包器
  // 静态解析不出来。Turbopack 遇到解析不出的动态路径会退化成「glob 整个项目根」，而
  // db.ts 被几乎所有路由/页面 import —— 于是 .next/standalone 里被塞进 src/ docs/ fnos/
  // scripts/ 和整个仓库，api/stats 的 .nft.json 非 node_modules 条目从 6 涨到 128。
  // fnos/build.sh 也跟着不再幂等：第二次打包会把上一轮的 app/server 嵌进新包。
  //
  // 这个目录是运行期由 Node 创建/读写的，不该由打包器 trace。加了这个注释，Turbopack
  // 就跳过对它的静态解析。对照实验与实测数字见 task-24。
  if (!fs.existsSync(/*turbopackIgnore: true*/ BACKUP_DIR)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `elec-backup-${timestamp}.db`;
  await db.backup(path.join(/*turbopackIgnore: true*/ BACKUP_DIR, fileName));
  return fileName;
}

// ─── 读数：查询 ─────────────────────────────────────────────────────────────

/**
 * 「前一条 / 后一条」的比较口径：先比日期，同一天再比时间；时间为 NULL 时
 * 当作空串（排在当天最早）。**必须带 reading_time** —— 只比日期的话，同一天
 * 录第二笔就找不到当天更早的那笔，previous_reading 会退回初始读数，用量被算大。
 */
export interface ReadingQuery {
  /** 起始日期（含），YYYY-MM-DD */
  start?: string;
  /** 结束日期（含），YYYY-MM-DD */
  end?: string;
  /** 返回条数上限 */
  limit?: number;
}

/** 列表。排序与 /api/readings 的既有实现一致：reading_date DESC, reading_time DESC */
export function getReadings(opts: ReadingQuery = {}): Reading[] {
  let sql = 'SELECT * FROM readings WHERE 1=1';
  const params: unknown[] = [];

  if (opts.start) {
    sql += ' AND reading_date >= ?';
    params.push(opts.start);
  }
  if (opts.end) {
    sql += ' AND reading_date <= ?';
    params.push(opts.end);
  }

  sql += ' ORDER BY reading_date DESC, reading_time DESC';

  if (opts.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }

  return getDb().prepare(sql).all(...params) as Reading[];
}

/**
 * 全部读数，供 CSV 导出用。
 *
 * 排序刻意与 getReadings 不同（只按 reading_date DESC）—— 这是 /api/export
 * 原有的行序，收敛 SQL 不该顺手改掉导出文件的内容顺序。
 */
export function getAllReadings(): Reading[] {
  return getDb().prepare('SELECT * FROM readings ORDER BY reading_date DESC').all() as Reading[];
}

export function getReadingById(id: string): Reading | undefined {
  return getDb().prepare('SELECT * FROM readings WHERE id = ?').get(id) as Reading | undefined;
}

export function getReadingsByIds(ids: readonly string[]): Reading[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return getDb().prepare(`SELECT * FROM readings WHERE id IN (${placeholders})`).all(...ids) as Reading[];
}

function findAdjacentReading(
  date: string,
  time: string | null | undefined,
  excludeId: string | undefined,
  direction: 'prev' | 'next',
): Reading | undefined {
  const cmp = direction === 'prev' ? '<' : '>';
  const order = direction === 'prev' ? 'DESC' : 'ASC';
  const params: unknown[] = [date, date, time ?? ''];

  let sql =
    `SELECT * FROM readings WHERE (reading_date ${cmp} ?` +
    ` OR (reading_date = ? AND COALESCE(reading_time, '') ${cmp} COALESCE(?, '')))`;
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  sql += ` ORDER BY reading_date ${order}, reading_time ${order} LIMIT 1`;

  return getDb().prepare(sql).get(...params) as Reading | undefined;
}

/** 严格早于 (date, time) 的最后一条；excludeId 用于「改自己」时把自己排除掉 */
export function findPreviousReading(
  date: string,
  time?: string | null,
  excludeId?: string,
): Reading | undefined {
  return findAdjacentReading(date, time, excludeId, 'prev');
}

/** 严格晚于 (date, time) 的第一条；excludeId 用于「改自己」时把自己排除掉 */
export function findNextReading(
  date: string,
  time?: string | null,
  excludeId?: string,
): Reading | undefined {
  return findAdjacentReading(date, time, excludeId, 'next');
}

// ─── 读数：写入 ─────────────────────────────────────────────────────────────

export interface CreateReadingInput {
  reading_value: number;
  reading_date: string;
  reading_time?: string | null;
  notes?: string | null;
  source?: Reading['source'];
  created_by?: string;
}

export interface UpdateReadingInput {
  reading_value: number;
  reading_date: string;
  reading_time: string | null;
  notes: string | null;
}

/**
 * 插入读数，并自行推导 previous_reading：
 * 有前一条就用它，没有就用设置里的初始读数。
 *
 * 推导放在这里而不是调用方，是为了 HTTP 和 MCP 两条写入路径不可能算出不同的值。
 * 调用方仍应先调 findPreviousReading / findNextReading 做单调性校验。
 */
export function createReading(input: CreateReadingInput): Reading {
  const time = input.reading_time || null;
  const prevReading = findPreviousReading(input.reading_date, time);
  const previous_reading = prevReading ? prevReading.reading_value : getInitialReading();

  const id = generateId();
  getDb().prepare(`
    INSERT INTO readings (id, reading_value, reading_date, reading_time, previous_reading, notes, source, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.reading_value,
    input.reading_date,
    time,
    previous_reading,
    input.notes ?? null,
    input.source ?? 'manual',
    input.created_by ?? 'user',
  );

  const created = getReadingById(id);
  if (!created) throw new Error(`读数插入后读不回来：${id}`);
  return created;
}

/**
 * 改完之后，若「原本紧跟其后的那条」的 previous_reading 指向旧值，跟着改掉。
 *
 * 必须把被改的这条排除掉：它可能被挪到比原来更晚的位置，那时它会出现在自己的
 * 「后一条」候选里 —— 结果 previous_reading 被改成自己的值，用量直接算成 0。
 */
function updateNextReadingPrevious(oldReading: Reading, newValue: number): void {
  const nextReading = findNextReading(oldReading.reading_date, oldReading.reading_time, oldReading.id);

  if (nextReading && nextReading.previous_reading === oldReading.reading_value) {
    getDb().prepare('UPDATE readings SET previous_reading = ? WHERE id = ?').run(newValue, nextReading.id);
  }
}

/** 更新一条读数，并级联修正后一条的 previous_reading。不存在时返回 undefined */
export function updateReading(id: string, patch: UpdateReadingInput): Reading | undefined {
  const db = getDb();
  const oldReading = getReadingById(id);
  if (!oldReading) return undefined;

  const run = db.transaction(() => {
    db.prepare(`
      UPDATE readings SET reading_value = ?, reading_date = ?, reading_time = ?, notes = ?
      WHERE id = ?
    `).run(patch.reading_value, patch.reading_date, patch.reading_time, patch.notes ?? null, id);

    updateNextReadingPrevious(oldReading, patch.reading_value);
  });

  run();
  return getReadingById(id);
}

/** 删除后把后一条的 previous_reading 接到被删那条的前一条上 */
function cascadeDelete(reading: Reading, newPreviousReading: number | null): void {
  getDb().prepare(`
    UPDATE readings SET previous_reading = ?
    WHERE (reading_date > ? OR (reading_date = ? AND COALESCE(reading_time, '') > COALESCE(?, '')))
    AND previous_reading = ?
  `).run(
    newPreviousReading,
    reading.reading_date,
    reading.reading_date,
    reading.reading_time ?? '',
    reading.reading_value,
  );
}

/** 删除一条读数，并级联修正。不存在时返回 false */
export function deleteReading(id: string): boolean {
  const db = getDb();
  const oldReading = getReadingById(id);
  if (!oldReading) return false;

  const prevReading = findPreviousReading(oldReading.reading_date, oldReading.reading_time);

  const run = db.transaction(() => {
    db.prepare('DELETE FROM readings WHERE id = ?').run(id);
    cascadeDelete(oldReading, prevReading ? prevReading.reading_value : null);
  });

  run();
  return true;
}

/**
 * 批量删除。按时间升序逐条删，删一条就修正一次后续关系 —— 与单条删除同一套逻辑，
 * 只是共用一个事务。返回实际删除条数。
 */
export function deleteReadings(ids: readonly string[]): number {
  const db = getDb();
  const readings = getReadingsByIds(ids);
  if (readings.length === 0) return 0;

  const sorted = [...readings].sort(
    (a, b) =>
      a.reading_date.localeCompare(b.reading_date) ||
      (a.reading_time ?? '').localeCompare(b.reading_time ?? ''),
  );

  const run = db.transaction(() => {
    for (const reading of sorted) {
      const prevReading = findPreviousReading(reading.reading_date, reading.reading_time);
      db.prepare('DELETE FROM readings WHERE id = ?').run(reading.id);
      cascadeDelete(reading, prevReading ? prevReading.reading_value : null);
    }
  });

  run();
  return sorted.length;
}

/**
 * 按时间升序重算所有 previous_reading：第一条用初始读数作基准，其余用前一条。
 * 返回重算条数与所用的初始读数。
 */
export function recalculatePreviousReadings(): { count: number; initialReading: number } {
  const db = getDb();
  const initialReading = getInitialReading();
  const allReadings = db.prepare(
    'SELECT id, reading_value, reading_date, reading_time FROM readings ORDER BY reading_date ASC, reading_time ASC',
  ).all() as Reading[];

  if (allReadings.length === 0) return { count: 0, initialReading };

  const run = db.transaction(() => {
    for (let i = 0; i < allReadings.length; i++) {
      const previous = i === 0 ? initialReading : allReadings[i - 1].reading_value;
      db.prepare('UPDATE readings SET previous_reading = ? WHERE id = ?').run(previous, allReadings[i].id);
    }
  });

  run();
  return { count: allReadings.length, initialReading };
}

// ─── 统计 ───────────────────────────────────────────────────────────────────

/**
 * 用电统计。
 *
 * 算法原样搬自 `/api/stats`（仪表盘一直在用的那份）：按**月末读数**逐月相减，
 * 第一个月用当月第一条读数的 previous_reading 当基线，每个月的量截到不小于 0。
 * 比「直接 SUM(units_consumed)」更准的地方有两点：
 *   · 跨月的那笔读数按自然月边界归属，不会被整笔算进读数所在的月份；
 *   · 抄表回退 / 改错造成的负差值截成 0，不会把总用电量冲小。
 * MCP 的 get_stats 以前用的是 SUM 那套，现在两条路径共用这一份。
 *
 * ⚠️ 同一个口径在 `src/lib/chart-data.ts` 的 monthlyConsumption / annualSeries 里
 * 也有一份（分析页用）。**改这里必须同步改那边** —— 三处并列时的定序要一致，否则
 * 同一天有多笔读数时，仪表盘和分析页会算出不同的数。
 *
 * 为什么没有抽成一个共享函数：`npm test` 用 `node --experimental-strip-types` 直接
 * import 这两个文件，raw Node 的 ESM 解析器不认 `src/lib` 里的无扩展名相对导入
 * （`from './xxx'`），抽出去会让 npm test 直接 ERR_MODULE_NOT_FOUND。要收敛得先解决
 * 测试入口的解析问题（见 scripts/test-calculations.ts 里的同款说明）。
 */
export function getStats(): Stats {
  const db = getDb();

  const totalReadings = (db.prepare('SELECT COUNT(*) as count FROM readings').get() as { count: number }).count;

  const readings = db.prepare(
    'SELECT reading_value, reading_date, reading_time, previous_reading FROM readings',
  ).all() as Array<{
    reading_value: number;
    reading_date: string;
    reading_time: string | null;
    previous_reading: number | null;
  }>;

  let totalConsumed = 0;
  let currentMonthConsumed = 0;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  if (readings.length > 0) {
    type Row = (typeof readings)[0];
    // 排序键：日期 + 时间。只比日期的话，同一天有多笔（reading_time 就是为这个场景
    // 设计的）时「当月最后一条」取决于输入顺序 —— 本查询与分析页拿到的顺序相反，
    // 于是同一个月的数字能差出好几倍（实测 300 vs 200）。
    const keyOf = (r: Row) => `${r.reading_date} ${r.reading_time ?? ''}`;

    const lastReadingOfMonth: Record<string, Row> = {};
    const firstReadingOfMonth: Record<string, Row> = {};
    readings.forEach((r) => {
      const month = r.reading_date.substring(0, 7);
      if (!lastReadingOfMonth[month] || keyOf(r) > keyOf(lastReadingOfMonth[month])) {
        lastReadingOfMonth[month] = r;
      }
      if (!firstReadingOfMonth[month] || keyOf(r) < keyOf(firstReadingOfMonth[month])) {
        firstReadingOfMonth[month] = r;
      }
    });

    const sortedMonths = Object.keys(lastReadingOfMonth).sort();
    for (let i = 0; i < sortedMonths.length; i++) {
      const month = sortedMonths[i];
      const currentReading = lastReadingOfMonth[month];
      const prevReading = i > 0 ? lastReadingOfMonth[sortedMonths[i - 1]] : undefined;

      // 第一个月没有上个月可减，用当月第一条读数的 previous_reading 当基线
      const monthConsumed = prevReading
        ? currentReading.reading_value - prevReading.reading_value
        : currentReading.reading_value - (firstReadingOfMonth[month]?.previous_reading ?? 0);

      totalConsumed += Math.max(0, monthConsumed);

      if (month === currentMonth) {
        currentMonthConsumed = Math.max(0, monthConsumed);
      }
    }
  }

  const rate = getRatePerKwh();

  return {
    totalReadings,
    totalConsumed,
    totalAmount: totalConsumed * rate,
    currentMonthConsumed,
    currentMonthAmount: currentMonthConsumed * rate,
  };
}
