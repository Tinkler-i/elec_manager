/**
 * 版本号解析与比较 —— 纯函数，零依赖。
 *
 * 不引 semver：我们自己的 tag 就是 `v1.9.1`，最多带个 `-beta.1`。但比较规则
 * 得按 semver 来，否则 `1.10.0` 会被字符串比较判成小于 `1.9.0`。
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** 预发布标识；空数组表示正式版 */
  prerelease: string[];
}

/** 解析 `v1.2.3` / `1.2` / `1.2.3-beta.1`；认不出来返回 null */
export function parseVersion(raw: string | null | undefined): ParsedVersion | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^v/i, "");
  if (!trimmed) return null;

  const [core, ...rest] = trimmed.split("-");
  const parts = core.split(".");
  if (parts.length < 2 || parts.length > 3) return null;

  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : Number.NaN));
  if (nums.some((n) => Number.isNaN(n))) return null;

  const [major, minor, patch = 0] = nums;
  const prerelease = rest.length > 0 ? rest.join("-").split(".") : [];
  return { major, minor, patch, prerelease };
}

/**
 * a > b 返回正数，a < b 返回负数，相等返回 0。
 * 任一侧解析不出来时返回 null —— 调用方要能区分「相等」和「比不了」。
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;

  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] > pb[key] ? 1 : -1;
  }

  // semver：正式版优先级高于预发布版（1.0.0 > 1.0.0-beta）
  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) return 1;
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) return -1;

  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i++) {
    const x = pa.prerelease[i];
    const y = pb.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;

    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) > Number(y) ? 1 : -1;
    } else if (x !== y) {
      // 纯数字标识符的优先级低于字母标识符
      if (xNum) return -1;
      if (yNum) return 1;
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

/** candidate 是否比 current 新。任一侧解析不了时一律当作「不是」 */
export function isNewer(candidate: string, current: string): boolean {
  const cmp = compareVersions(candidate, current);
  return cmp !== null && cmp > 0;
}

/**
 * 当前版本。
 *
 * 飞牛启动应用进程时会注入 `TRIM_APPVER`（取自 manifest.version），那是「实际
 * 装着的版本」，优先级最高 —— 应用中心里显示的是它，检查更新就该跟它比。
 * 本地和 Docker 下没有这个变量，退回构建期注入的 package.json 版本。
 */
export function currentVersion(): string {
  return process.env.TRIM_APPVER || process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
}
