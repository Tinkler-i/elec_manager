/**
 * 「并发取数」的状态推导 —— 纯函数，不依赖 React、不依赖任何包。
 *
 * 改自 workbuddy-manager（MIT）的 `web/lib/async-state.ts`。放成纯函数而不是
 * 塞在 hook 里，是为了能直接用 node 跑测试（见 lib/async-state.test.mjs），
 * 也为了让「什么算加载中」这类判断只有一处定义。
 */

/** initial = 换了数据上下文（比如切换统计范围）；refresh = 同一上下文下重取 */
export type FetchMode = "initial" | "refresh";

export interface AsyncValues {
  /** 已成功取到的字段 */
  values: Record<string, unknown>;
  /** 失败的字段 → 原因。成功的字段不会出现在这里 */
  errors: Record<string, unknown>;
}

/**
 * 把一次并发取数的结果拆成「成功的字段」与「失败的字段」。
 *
 * 用 allSettled 而不是 all：一份数据挂了不该拖垮其余几份。首页要同时拿
 * 统计、读数、设置三份，设置接口抽风不该让整页变成错误态。
 */
export function splitSettled(
  keys: readonly string[],
  settled: readonly PromiseSettledResult<unknown>[],
): AsyncValues {
  const values: Record<string, unknown> = {};
  const errors: Record<string, unknown> = {};
  settled.forEach((r, i) => {
    const key = keys[i];
    if (key === undefined) return; // 结果比键多：忽略，而不是塞个 undefined 键
    if (r.status === "fulfilled") values[key] = r.value;
    else errors[key] = r.reason;
  });
  return { values, errors };
}

/**
 * 界面该显示什么。三者互斥。
 *
 *  · isInitialLoading —— 一次都没成功过，且请求还在飞 → 显示骨架。
 *    判据是「没有数据」而不是「请求在飞」：有心跳轮询的页面若用后者，
 *    骨架会每隔一个心跳闪一次。
 *  · isInitialFailed —— 请求已结束、一个字段都没成功 → 显示错误态与「重试」。
 *    既不能一直转圈，也不能显示「暂无数据」——那是撒谎，数据是没取到。
 *  · isRefreshing —— 已有数据、请求在飞 → 内容保持不变，只做轻提示。
 */
export function asyncFlags(
  values: Record<string, unknown>,
  errors: Record<string, unknown>,
  pending: boolean,
): { isInitialLoading: boolean; isInitialFailed: boolean; isRefreshing: boolean } {
  const hasData = Object.keys(values).length > 0;
  const hasErrors = Object.keys(errors).length > 0;
  return {
    isInitialLoading: pending && !hasData,
    isInitialFailed: !pending && !hasData && hasErrors,
    isRefreshing: pending && hasData,
  };
}

/**
 * 两组依赖的指纹。
 *
 * `context` 是数据上下文（换统计口径、换年份这类），`query` 是同一上下文里的
 * 查询范围（翻页、改日期区间）。两者对界面的要求正好相反，所以要分开记。
 */
export interface DepPrints {
  /** 数据上下文。`null` 表示「还没跑过首屏」，于是首次一定算出 initial */
  context: string | null;
  /** 查询范围 */
  query: string;
}

/**
 * 依赖变化 → 该用哪种取数模式。返回 null 表示什么都没变，不必重取。
 *
 *  · 换上下文 → 屏幕上的数字属于旧上下文，必须清掉。翻页时若也清空，
 *    每翻一页闪一次骨架，而翻页是高频操作。
 *  · 换查询范围 → 旧内容留在屏幕上直到新数据到达。
 *
 * 两者同时变化时按「上下文变了」处理：先清空再合并旧数据毫无意义。
 */
export function depMode(prev: DepPrints, next: DepPrints): FetchMode | null {
  if (prev.context !== next.context) return "initial";
  if (prev.query !== next.query) return "refresh";
  return null;
}
