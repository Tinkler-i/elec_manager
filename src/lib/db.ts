import Database from 'better-sqlite3';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = process.env.ELEC_DB_PATH || path.join(process.cwd(), 'data', 'elec.db');

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
export const DATA_DIR = process.env.ELEC_DATA_DIR || path.dirname(DB_PATH);

/** 备份目录，可用 ELEC_BACKUP_DIR 覆盖（飞牛包显式指向 TRIM_PKGVAR/backups） */
export const BACKUP_DIR = process.env.ELEC_BACKUP_DIR || path.join(DATA_DIR, 'backups');

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
