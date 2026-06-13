import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDb } from './db';

const TOKEN_EXPIRY = '365d';

/**
 * 获取 JWT Secret
 * 优先级：环境变量 JWT_SECRET > 持久化文件 > 自动生成
 * 密钥存储在数据库同目录下的 jwt_secret 文件，确保重启/升级后仍有效
 */
function getJwtSecret(): string {
  // 1. 环境变量优先
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  // 2. 密钥文件路径：与数据库同目录
  const dbPath = process.env.ELEC_DB_PATH || path.join(process.cwd(), 'data', 'elec.db');
  const secretFile = path.join(path.dirname(dbPath), 'jwt_secret');

  try {
    if (fs.existsSync(secretFile)) {
      const stored = fs.readFileSync(secretFile, 'utf-8').trim();
      if (stored) {
        process.env.JWT_SECRET = stored;
        return stored;
      }
    }
  } catch {
    // 文件读取失败，继续生成
  }

  // 3. 自动生成并持久化
  const generated = crypto.randomBytes(48).toString('base64');
  try {
    const dir = path.dirname(secretFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  } catch {
    console.warn('无法持久化 JWT_SECRET，重启后 token 将失效。请设置 JWT_SECRET 环境变量。');
  }

  process.env.JWT_SECRET = generated;
  return generated;
}

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
