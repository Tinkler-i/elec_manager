/**
 * 提交信息规范检查（`consistency.yml` 的 `commit-msg` job 调用）。
 *
 * 从 stdin 读 `git log --format='%H%x1f%s%x1f%b%x1e'` 的输出，逐条判，有违规就 exit 1。
 * 「哪些提交要查」是 `scripts/check-pushed-commits.sh` 的事 —— 这里只管判据，
 * 所以它可以脱离 git 单独喂数据验证（见该脚本头部）。
 *
 * 判据（规范在 CONTRIBUTING.md 的「提交」一节）：
 *   1. 标题形如 `<type>(<scope>): <说明>`，type 取 feat|fix|docs|refactor|test|chore|ci|perf
 *   2. 标题 ≤ 50 字（硬上限 72）—— 超了就是红，不是警告
 *   3. 正文非空行 ≤ 5（正文默认不写）
 *   4. 标题或正文里不出现 `task-N`
 *
 * 失败时逐条打印：提交哈希 + 犯了哪条 + 实际值，并输出一行 `::error::` 让 CI 界面
 * 直接标出来 —— 只报「格式不对」等于没报。
 *
 * 由 `scripts/check-pushed-commits.sh` 调用。单独跑也行：
 *   printf 'sha\x1ffix: 修个东西\x1f' | node scripts/check-commit-messages.mjs
 */
import fs from 'node:fs';

const RECORD = '\x1e';
const FIELD = '\x1f';

const TITLE_RE = /^(feat|fix|docs|refactor|test|chore|ci|perf)(\([^)]+\))?: .+/;
const TITLE_TARGET = 50;
const TITLE_HARD = 72;
const BODY_MAX_LINES = 5;
const TASK_RE = /task-\d+/i;

/** 按「字」数，不是按 UTF-16 码元 —— 否则纯中文标题的宽度会算少一半 */
const width = (s) => [...s].length;

function violationsFor(subject, body) {
  const out = [];

  if (!TITLE_RE.test(subject)) {
    out.push(
      `标题不符合 <type>(<scope>): <说明>；允许的 type：feat fix docs refactor test chore ci perf。` +
        `实际标题：${JSON.stringify(subject)}`,
    );
  }

  const n = width(subject);
  if (n > TITLE_TARGET) {
    out.push(
      n > TITLE_HARD
        ? `标题 ${n} 字，超过硬上限 ${TITLE_HARD}（目标 ≤${TITLE_TARGET}）`
        : `标题 ${n} 字，超过 ${TITLE_TARGET} 字上限（硬上限 ${TITLE_HARD}）`,
    );
  }

  const bodyLines = body.split('\n').filter((line) => line.trim() !== '').length;
  if (bodyLines > BODY_MAX_LINES) {
    out.push(`正文 ${bodyLines} 行非空内容，超过 ${BODY_MAX_LINES} 行上限（正文默认不写）`);
  }

  const hit = `${subject}\n${body}`.match(TASK_RE);
  if (hit) {
    out.push(`出现任务编号 ${hit[0]} —— 协作痕迹不进 commit，写进报告`);
  }

  return out;
}

const raw = fs.readFileSync(0, 'utf8');
const commits = raw
  .split(RECORD)
  .map((r) => r.trim())
  .filter(Boolean)
  .map((record) => {
    const [sha, subject, ...rest] = record.split(FIELD);
    return { sha: sha ?? '', subject: subject ?? '', body: rest.join(FIELD) };
  });

if (commits.length === 0) {
  console.log('⚠️ 本次范围内没有可检查的提交。');
  console.log('  只推 merge 提交时这是正常的；但如果刚推了普通提交也看到这句，说明范围算错了，别当成通过。');
  process.exit(0);
}

const bad = [];
for (const c of commits) {
  const violations = violationsFor(c.subject, c.body);
  if (violations.length > 0) {
    bad.push({ ...c, violations });
  } else {
    console.log(`✓ ${c.sha.slice(0, 7)}  ${c.subject}`);
  }
}

if (bad.length > 0) {
  console.log('');
  console.log(`✗ 本次 ${commits.length} 个提交里有 ${bad.length} 个不合规：`);
  for (const c of bad) {
    console.log('');
    console.log(`  ${c.sha.slice(0, 7)}  ${c.subject}`);
    for (const v of c.violations) {
      console.log(`      - ${v}`);
    }
    console.log(`      ::error title=提交信息不合规::${c.sha.slice(0, 7)} ${c.violations.join('；')}`);
  }
  console.log('');
  console.log('规范见 CONTRIBUTING.md 的「提交」一节。上面每个提交都列了具体是哪条、实际值是多少。');
  process.exit(1);
}

console.log(`✓ 本次 ${commits.length} 个提交的标题与正文都合规`);
