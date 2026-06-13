import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDb } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'elec-meter-secret-key-change-in-production';
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
  return jwt.sign({ auth: true }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): boolean {
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}
