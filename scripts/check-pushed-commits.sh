#!/usr/bin/env bash
#
# 找出「本次推送进来的提交」，交给 scripts/check-commit-messages.mjs 判。
#
# 由 consistency.yml 的 commit-msg job 调用（只挂 push 事件）。判据全在 .mjs 里，
# 这个脚本只负责「范围」—— 边界都显式打印，没有静默跳过。
#
# 范围口径：
#   · after 是全 0            → 分支删除，本次推送没有新提交。打印原因后 exit 0。
#   · before 是全 0           → 首次推送 / 新分支。以 origin/<默认分支> 为基准列差集；
#                              基准不存在（例如仓库的第一次推送）就退化为 after 可达的全部提交。
#   · before 在本地不可达     → 多半是 force-push 把旧提交冲掉了。先单独 fetch 一次；
#                              仍拿不到就降级为「只查 after 这一个提交」，并打印降级原因。
#   · 其它                    → before..after（常规差集）。
#   merge 提交一律跳过（那是 Git 生成的，不该按人的提交信息规范要求），跳过几个也打印出来。
#
# 本地自测（不需要真 git，可以拿桩）：见 skill 里的说明，或直接
#   BEFORE=<sha> AFTER=<sha> bash scripts/check-pushed-commits.sh
set -euo pipefail

ZERO="0000000000000000000000000000000000000000"
BEFORE="${BEFORE:-}"
AFTER="${AFTER:-}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-}"

if [ -z "${AFTER}" ] || [ "${AFTER}" = "${ZERO}" ]; then
    echo "跳过：这是一次分支删除（github.event.after 是全 0），本次推送没有引入新提交。"
    exit 0
fi

RANGE=()
if [ -z "${BEFORE}" ] || [ "${BEFORE}" = "${ZERO}" ]; then
    BASE="origin/${DEFAULT_BRANCH}"
    if [ -n "${DEFAULT_BRANCH}" ] && git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null 2>&1; then
        echo "首次推送或新分支（before 是全 0）：以 ${BASE} 为基准列出本次带入的提交。"
        RANGE=("${AFTER}" --not "${BASE}")
    else
        echo "首次推送或新分支（before 是全 0），且本地没有默认分支可作基准（例如仓库的第一次推送）："
        echo "  改为检查 after 可达的全部提交。"
        RANGE=("${AFTER}")
    fi
elif git rev-parse --verify --quiet "${BEFORE}^{commit}" >/dev/null 2>&1; then
    RANGE=("${BEFORE}..${AFTER}")
else
    echo "⚠️ 本地找不到 before=${BEFORE} —— 多半是 force-push 把旧提交冲成了不可达。"
    if git fetch --no-tags --quiet origin "${BEFORE}" >/dev/null 2>&1 \
        && git rev-parse --verify --quiet "${BEFORE}^{commit}" >/dev/null 2>&1; then
        echo "  已单独拉取到该对象，按常规差集检查。"
        RANGE=("${BEFORE}..${AFTER}")
    else
        echo "  拉取不到。改为只检查 after 这一个提交 —— 这是显式降级，不是静默跳过。"
        RANGE=(-1 "${AFTER}")
    fi
fi

MERGES="$(git rev-list --count --merges "${RANGE[@]}" 2>/dev/null || echo 0)"
echo "检查范围：${RANGE[*]}"
echo "跳过 merge 提交 ${MERGES} 个（合并提交由 Git 生成，不该按人的提交信息规范要求）"
echo ""

git log --no-merges "${RANGE[@]}" --format='%H%x1f%s%x1f%b%x1e' | node scripts/check-commit-messages.mjs
