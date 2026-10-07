/**
 * 提交信息规范的**入口**。判据只有一份，在 `scripts/lib/commit-message-rules.mjs`。
 *
 * 两种输入，走的是同一个 `checkCommits()`：
 *   · 默认：从 stdin 读 `git log --format='%H%x1f%s%x1f%b%x1e'` 的输出（CI 用，
 *     由 `scripts/check-pushed-commits.sh` 喂）
 *   · `--message-file <路径>`：读单个提交信息文件（`.githooks/commit-msg` 用，
 *     git 把提议的提交信息写在这个文件里）
 *
 * 之所以要两种输入：钩子拿到的是**一个信息文件**，CI 拿到的是**一批 git log 记录**，
 * 接口对不上。但判据和措辞都不该有两份 —— 所以只在这里做「适配」，规则全在 rules 里。
 *
 * 单独跑也行：
 *   printf 'sha\x1ffield: 修个东西\x1f' | node scripts/check-commit-messages.mjs
 */
import fs from 'node:fs';
import { checkCommits, renderResult } from './lib/commit-message-rules.mjs';

const RECORD = '\x1e';
const FIELD = '\x1f';

function parseArgs(argv) {
  const out = { messageFile: '', commentChar: '#' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--message-file') {
      out.messageFile = argv[++i] ?? '';
    } else if (arg === '--comment-char') {
      out.commentChar = argv[++i] ?? '#';
    } else {
      console.error(`未知参数：${arg}`);
      process.exit(2);
    }
  }
  return out;
}

/**
 * 提交信息文件 → `{subject, body}`。
 * 按 git 自己的 `--cleanup=strip` 口径：去掉注释行、标题前的空行、结尾空行。
 * 不这么做的话，模板里的 `# 请填写…` 注释会被算成正文行数。
 */
function parseMessageFile(text, commentChar) {
  const lines = text.split('\n').map((line) => line.replace(/\s+$/, ''));
  let subject = null;
  const bodyLines = [];

  for (const line of lines) {
    if (commentChar && line.startsWith(commentChar)) {
      continue;
    }
    if (subject === null) {
      if (line.trim() === '') {
        continue;
      }
      subject = line;
      continue;
    }
    bodyLines.push(line);
  }

  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') {
    bodyLines.pop();
  }

  return { subject: subject ?? '', body: bodyLines.join('\n') };
}

/** stdin：一批 `%H%x1f%s%x1f%b%x1e` 记录 → 提交列表 */
function readLogRecords(raw) {
  return raw
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, ...rest] = record.split(FIELD);
      return { sha: (sha ?? '').slice(0, 7), subject: subject ?? '', body: rest.join(FIELD) };
    });
}

const args = parseArgs(process.argv.slice(2));

if (args.messageFile) {
  if (!fs.existsSync(args.messageFile)) {
    console.error(`✗ 找不到提交信息文件：${args.messageFile}`);
    console.error('  git 会把提议的提交信息写到这个文件并通过 $1 传给 commit-msg 钩子。');
    process.exit(2);
  }
  const { subject, body } = parseMessageFile(
    fs.readFileSync(args.messageFile, 'utf8'),
    args.commentChar,
  );
  // 没有 sha —— 提交还没产生。用占位符，别让它看起来像一个真的提交号。
  const result = checkCommits([{ sha: '(本次提交)', subject, body }]);
  process.exit(renderResult(result, { single: true }));
}

process.exit(renderResult(checkCommits(readLogRecords(fs.readFileSync(0, 'utf8')))));
