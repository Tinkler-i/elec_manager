import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDb } from './db';

const DEFAULT_SECRET = 'elec-meter-secret-key-change-in-production';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || DEFAULT_SECRET;
  if (process.env.NODE_ENV === 'production' && secret === DEFAULT_SECRET) {
    throw new Error('生产环境必须设置 JWT_SECRET 环境变量，不能使用默认值');
  }
  return secret;
}
const TOKEN_EXPIRY = '365d';

export interface User {
  username: string;
  password_hash: string;
}

export function initializeAuth() {
  const db = getDb();
  const userSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('auth_password') as { value: string } | undefined;
  if (!userSetting) {
    const defaultHash = bcrypt.hashSync('admin', 10);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('auth_password', defaultHash);
  }
}

export function verifyPassword(password: string): boolean {
  const db = getDb();
  const userSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('auth_password') as { value: string } | undefined;
  if (!userSetting) return false;
  return bcrypt.compareSync(password, userSetting.value);
}

export function changePassword(newPassword: string) {
  const db = getDb();
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run('auth_password', hash);
}

export function generateToken(): string {
  return jwt.sign({ auth: true }, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): boolean {
  try {
    jwt.verify(token, getJwtSecret());
    return true;
  } catch {
    return false;
  }
}
