/**
 * 构建后检查：`.next/standalone` 顶层不该出现**仓库里已有的东西**。
 *
 * 为什么是「检查」而不是「清理」：清理会把问题**掩盖**掉 —— 下一次再泄漏你也不会知道。
 * 这里直接让构建失败（exit 1）并把实际顶层内容打出来，是一道**会响的门**。
 *
 * 为什么会泄漏：Turbopack 会把仓库里能静态分析到的路径 trace 进 standalone。
 * 而 `Dockerfile`、`fnos/build.sh`、以及「直接拿 standalone 部署」这几条路都消费这个目录
 * —— 泄漏进去就会跟着发出去。实测过两种形态：
 *   · 单点泄漏：顶层冒出 `data`（里面是 `elec.db` / `jwt_secret`）
 *   · 整个仓库被 glob：顶层冒出 `Dockerfile`、`README.md`、`package-lock.json`、
 *     `next.config.ts`、`deploy.sh`、`.dockerignore` …… 其中 `.env` 是凭据文件
 *
 * 判据：**顶层出现任何「仓库根目录里也存在」的条目 → 红。**
 * 为什么不是枚举黑名单：黑名单忘加一项就是漏 —— 上面第二种形态里那些根文件，
 * 早期的 `['data','fnos','docs','scripts','src']` 一个都盖不住。改成与仓库根比对之后，
 * 以后新增目录/文件不用维护名单。
 *
 * 试过的死路（别再试）：
 *   · `outputFileTracingExcludes` —— 见 next.config.ts 里那段记录
 *   · 把 ignore 写在语句位置 —— 必须是**实参位置**，见 src/lib/auth.ts
 *
 * 由 `package.json` 的 `postbuild` 自动挂上，所以 `npm run build` 的三个使用方
 * （ci.yml、build-fpk.yml、fnos/build.sh）都被覆盖，不需要各自再写一遍。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');

/**
 * standalone 顶层本来就该有的四项。
 * `.next` / `node_modules` / `package.json` 仓库根也有，所以必须显式放行；
 * `server.js` 是 Next 生成的、仓库根没有它，列在这里只是让「该有什么」一眼看得全。
 */
const EXPECTED = new Set(['.next', 'node_modules', 'package.json', 'server.js']);

// output: "standalone" 是这个项目的硬要求（Dockerfile / fnos 打包 / 冷启动测试都依赖它）。
// 它不在，说明构建配置被改坏了 —— 这种情况必须响，不能当成「没东西可检查」放过去。
if (!fs.existsSync(STANDALONE)) {
  console.error(`✗ 找不到 ${STANDALONE}`);
  console.error('  这个项目的 next.config.ts 声明了 output: "standalone"，构建后它必须存在。');
  process.exit(1);
}

const top = fs.readdirSync(STANDALONE).sort();
console.log(`standalone 顶层（${top.length} 项）: ${top.join(', ')}`);

// 全部收集完再报，不要命中第一个就 return —— 一次看全才知道漏了多少。
const leaked = top.filter(
  (name) => !EXPECTED.has(name) && fs.existsSync(path.join(ROOT, name)),
);

if (leaked.length > 0) {
  console.error('');
  console.error(`✗ standalone 顶层混进了仓库里已有的条目（${leaked.length} 项）:`);
  for (const name of leaked) {
    console.error(`    ${name}`);
  }
  console.error('  这些是仓库内容被 Turbopack trace 进来了，不该随构建产物发出去。');
  console.error('  修法：给 src/lib 里那条路径的实参加上 /*turbopackIgnore: true*/（见 auth.ts / db.ts）。');
  process.exit(1);
}

console.log('✓ standalone 顶层干净');
