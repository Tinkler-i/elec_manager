/**
 * 提交信息规范 —— **唯一的判据**。
 *
 * 规范文本在 `CONTRIBUTING.md` 的「提交」一节。这里只放判据，三个入口共用，
 * 谁都不许再抄一份规则（抄出来的第二份早晚会漂）：
 *
 *   · `.githooks/commit-msg`  → 提交**产生之前**拦住（唯一真正的拦截点）
 *   · CI `consistency.yml` 的 `commit-msg` job → push 与 PR 两条路径事后查
 *   两者都通过 `scripts/check-commit-messages.mjs` 走到这里。
 *
 * 判据：
 *   1. 标题形如 `<type>(<scope>): <说明>`，type 取 feat|fix|docs|refactor|test|chore|ci|perf
 *   2. 标题 ≤ 50 字（**超过即红**，不是警告）
 *   3. 正文非空行 ≤ 5（正文默认不写）
 *   4. 标题或正文里不出现 `task-N`
 */

export const TITLE_RE = /^(feat|fix|docs|refactor|test|chore|ci|perf)(\([^)]+\))?: .+/;
export const TITLE_MAX = 50;
export const BODY_MAX_LINES = 5;
export const TASK_RE = /task-\d+/i;

/** 按「字」数，不是 UTF-16 码元 —— 否则纯中文标题会少算一半 */
export const width = (s) => [...s].length;

/** 单条提交违反了什么。合规返回空数组。 */
export function violationsFor(subject, body) {
  const out = [];

  if (!TITLE_RE.test(subject)) {
    out.push(
      `标题不符合 <type>(<scope>): <说明>；允许的 type：feat fix docs refactor test chore ci perf。` +
        `实际标题：${JSON.stringify(subject)}`,
    );
  }

  const n = width(subject);
  if (n > TITLE_MAX) {
    out.push(`标题 ${n} 字，超过 ${TITLE_MAX} 字上限`);
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

/** commits: `[{sha, subject, body}]` */
export function checkCommits(commits) {
  const bad = [];
  for (const c of commits) {
    const violations = violationsFor(c.subject, c.body);
    if (violations.length > 0) {
      bad.push({ ...c, violations });
    }
  }
  return { total: commits.length, bad };
}

/**
 * 打印结果并给出退出码。两个入口共用 —— 「怎么说」也保持一致，
 * 免得钩子和 CI 对同一个问题给出两套说法。
 *
 * `scale` 只影响措辞（单个提交 / 一批提交），不参与判断。
 */
export function renderResult(result, { single = false } = {}) {
  if (result.total === 0) {
    console.log('⚠️ 本次范围内没有可检查的提交。');
    console.log('  只推 merge 提交时这是正常的；但如果刚推了普通提交也看到这句，说明范围算错了，别当成通过。');
    return 0;
  }

  if (result.bad.length === 0) {
    console.log(`✓ ${single ? '提交信息合规' : `本次 ${result.total} 个提交的标题与正文都合规`}`);
    return 0;
  }

  console.log('');
  console.log(
    single
      ? '✗ 提交信息不合规，这次提交已被拒绝：'
      : `✗ 本次 ${result.total} 个提交里有 ${result.bad.length} 个不合规：`,
  );

  for (const c of result.bad) {
    console.log('');
    console.log(`  ${c.sha}  ${c.subject}`);
    for (const v of c.violations) {
      console.log(`      - ${v}`);
    }
    console.log(`      ::error title=提交信息不合规::${c.sha} ${c.violations.join('；')}`);
  }

  console.log('');
  console.log('规范见 CONTRIBUTING.md 的「提交」一节。上面每条都写了是哪条规则、实际值是多少。');
  if (single) {
    console.log('改好提交信息再提交一次（钩子在提交产生之前就把它拦下来了）。');
  }
  return 1;
}
