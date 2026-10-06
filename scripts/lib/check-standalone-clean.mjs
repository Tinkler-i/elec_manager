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
 * 为什么不会因为冷启动测试误报：`scripts/lib/postbuild-server.mjs` 的 `ensureStandalone()`
 * 会把 `public` / `.next/static` 拷进 standalone，所以「先跑测试、紧接着 build」这个顺序
 * 看起来会留下一个多出来的 `public`。实测**不误报** —— `next build` 默认
 * `cleanDistDir: true`，重建时整个 `.next` 会被清掉，上一轮拷进去的 `public` 不复存在。
 * （QA 跑过这个序列：build → 冷启动测试 → build，第二次仍是顶层 4 项 ✓。）
 *
 * 试过的死路（别再试）：
 *   · `outputFileTracingExcludes` —— 见 next.config.ts 里那段记录
 *   · 把 ignore 写在语句位置 —— 必须是**实参位置**，见 src/lib/auth.ts
 *
 * 由 `package.json` 的 `postbuild` 自动挂上；`ci.yml` / `build-fpk.yml` / `fnos/build.sh`
 * 里另有一层**显式调用**，不依赖这个钩子（钩子被误删时仍会拦）。
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
 *
 * 已知边界 —— `public`：它既可能是泄漏症状（whole-project glob 那次 21 项里就有它），
 * 也是合法运行期需求（`fnos/build.sh` / `Dockerfile` 都要把 `public` 搬进去）。今天它
 * 出现在顶层就是泄漏症状，所以**不预先放行**。将来 Next 真把它生成进 standalone 时，
 * 按下面失败信息里的处置指引加进来即可 —— 宁可在无害时红一次，也不为了不误报把门改宽。
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
  // 标注文件/目录：两种泄漏形态靠这个区分 —— 目录（`data`/`src`/`docs`）多半是某条路径被
  // 单点 trace；根文件（`Dockerfile`/`.env`/`README.md`）则是「整个仓库被 glob」。
  // 判据一样，但线索不同，省得读者自己去 ls。
  const width = Math.max(...leaked.map((name) => name.length));
  console.error('');
  console.error(`✗ standalone 顶层混进了仓库里已有的条目（${leaked.length} 项）:`);
  for (const name of leaked) {
    const kind = fs.statSync(path.join(STANDALONE, name)).isDirectory() ? '目录' : '文件';
    console.error(`    ${name.padEnd(width)}  ${kind}`);
  }
  console.error('');
  console.error(`  standalone 顶层本该只有: ${[...EXPECTED].join(', ')}`);
  console.error('');
  console.error('  这些是构建期被 Turbopack trace 进来的仓库内容，不该随产物发出去。');
  console.error('  处置：');
  console.error('    1) 先修源头：给 src/lib 里那条路径的实参加上 /*turbopackIgnore: true*/');
  console.error('       （见 src/lib/auth.ts / db.ts）。多数情况到这一步就好了。');
  console.error('    2) 若确认某一项是 Next 新版本正常生成的、不是泄漏，把它加进本脚本的');
  console.error('       EXPECTED，并在那里写明原因。');
  console.error('    3) 不要改成「忽略整类」（按后缀、按看起来像生成物之类）—— 那是把门改宽，');
  console.error('       正是这一轮反复踩的「看起来在拦、其实没拦」。');
  process.exit(1);
}

console.log('✓ standalone 顶层干净');
