import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DB_PATH, getSetting, setSetting } from './db';

const TOKEN_EXPIRY = '365d';

/**
 * 初始化 JWT Secret，并写回 `process.env.JWT_SECRET`。
 * 优先级：环境变量 JWT_SECRET > 持久化文件 > 自动生成
 * 密钥存储在数据库同目录下的 jwt_secret 文件，确保重启/升级后仍有效
 *
 * 除了这里内部的懒加载调用，`src/instrumentation.ts` 会在服务启动时先调一次 ——
 * `src/proxy.ts` 在 Edge runtime 每个请求都要密钥，而它只能读 process.env，
 * 冷启动后如果没人先跑过这个函数，proxy 就验证不了任何 token。
 */
export function ensureJwtSecret(): string {
  // 1. 环境变量优先
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  // 2. 密钥文件路径：与数据库同目录。路径来源只有 db.ts 一处，别在这里重写表达式
  const secretFile = path.join(path.dirname(DB_PATH), 'jwt_secret');

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
  // 用 === undefined 判断「没这一项」：空串也算已设置，不能重新灌默认密码
  if (getSetting('auth_password') === undefined) {
    setSetting('auth_password', bcrypt.hashSync('admin', 10));
  }
}

export function verifyPassword(password: string): boolean {
  const stored = getSetting('auth_password');
  if (!stored) return false;
  return bcrypt.compareSync(password, stored);
}

export function changePassword(newPassword: string) {
  setSetting('auth_password', bcrypt.hashSync(newPassword, 10));
}

export function generateToken(): string {
  return jwt.sign({ auth: true }, ensureJwtSecret(), { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): boolean {
  try {
    jwt.verify(token, ensureJwtSecret());
    return true;
  } catch {
    return false;
  }
}
