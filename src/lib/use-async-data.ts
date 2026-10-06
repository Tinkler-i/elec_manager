"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { asyncFlags, depMode, splitSettled, type DepPrints, type FetchMode } from "@/lib/async-state";

/** 字段名 → 取数函数 */
export type AsyncFetchers<T> = { [K in keyof T]: () => Promise<T[K]> };

export interface AsyncAllState<T> {
  /**
   * 已成功取到的字段。
   *
   * 刷新时某个字段失败，它保留上一次的值 —— 那份数据仍然是对的，只是可能不是
   * 最新的。清成空会让整块内容凭空消失，比显示旧值更糟。
   */
  values: Partial<T>;
  /** 失败的字段 → 原因。成功的字段不会出现在这里 */
  errors: Partial<Record<keyof T, unknown>>;
  /** 首屏未就绪（还没拿到任何数据）→ 显示骨架 */
  isInitialLoading: boolean;
  /** 首屏彻底失败（一个字段都没成功）→ 显示错误态与「重试」 */
  isInitialFailed: boolean;
  /** 已有数据、后台正在刷新 → 内容保持不变，仅用于轻提示 */
  isRefreshing: boolean;
  /**
   * 重新拉取一次（保留现有数据）。
   *
   * 返回本次刷新是否全部成功，并在请求落地后才 resolve。需要它的场景是
   * 「先写、再刷列表」—— 建完记录要能区分「创建失败」与「建好了但列表没刷上」，
   * 后者绝不能报成前者（用户会以为没成功、再点一次，于是建出重复数据）。
   */
  reload: () => Promise<boolean>;
}

/**
 * 并发取多个字段，并把「首屏」与「后台刷新」两种状态区分开。
 *
 * 改自 workbuddy-manager（MIT）的 `web/lib/use-async-data.ts`。原来每页各写一遍
 * `Promise.allSettled` + 若干个 useState，于是各自漏掉同一批东西 —— 没有加载态
 * （把「还没取到」显示成「暂无数据」）、没有错误态（失败只 console.error）、
 * 换筛选条件时旧数据仍留在屏幕上。
 *
 * 状态怎么推导在 lib/async-state.ts 里（纯函数，可单独测）。
 *
 * @param fetchers 字段名 → 取数函数。可以内联写箭头函数，不必用 useMemo 包。
 * @param deps     数据上下文（例如 [range]）。变了就重取，且先清空旧数据。
 * @param refreshDeps 同一上下文里的查询范围（例如翻页用的 [page]）。变了只重取，不清空。
 */
export function useAsyncAll<T extends Record<string, unknown>>(
  fetchers: AsyncFetchers<T>,
  deps: readonly unknown[] = [],
  refreshDeps: readonly unknown[] = [],
): AsyncAllState<T> {
  const [values, setValues] = useState<Partial<T>>({});
  const [errors, setErrors] = useState<Partial<Record<keyof T, unknown>>>({});
  const [pending, setPending] = useState(true);

  /**
   * 请求序号：只让最新一次发起的请求写状态。
   *
   * 两种会撞车的情形：切换筛选条件时旧请求后到、把新数据覆盖掉；心跳与手动
   * 重试交叠，先发的慢、后发的快。每次发起自增，回来时对不上就整包丢弃。
   */
  const seq = useRef(0);

  /**
   * fetchers 每次渲染都是新对象（调用方写的是内联箭头函数），不能进依赖数组；
   * 用 ref 取最新的一份，run 才能保持稳定。
   *
   * 同步动作放在 effect 里（且声明在下面的取数 effect 之前，保证先跑）——
   * 渲染期写 ref 会被 React 19 的 lint 规则拦下，并发渲染下也不安全。
   * ref 的初值就是首帧的 fetchers，所以首屏那次取数不依赖这个 effect 是否已执行。
   */
  const ref = useRef(fetchers);
  useEffect(() => {
    ref.current = fetchers;
  });

  const run = useCallback((mode: FetchMode): Promise<boolean> => {
    const mine = ++seq.current;
    if (mode === "initial") {
      // deps 变了 = 换了一个数据上下文。旧数据必须清掉：留着比空着更糟
      setValues({});
      setErrors({});
    }
    setPending(true);

    const keys = Object.keys(ref.current) as (keyof T)[];
    return Promise.allSettled(keys.map((k) => ref.current[k]())).then((settled) => {
      // 过期响应：整包丢弃。这里返回 true 而不是 false —— 这一次的成败已经不作数，
      // 返回 false 会让调用方凭空报一次失败。
      if (mine !== seq.current) return true;

      const fresh = splitSettled(keys as string[], settled);
      // 刷新时合并而不是替换：这次失败的字段保留上一次的值
      setValues((prev) => (mode === "initial" ? fresh.values : { ...prev, ...fresh.values }) as Partial<T>);
      // errors 整体替换：这次成功了的字段，上一次的失败记录要一并清掉
      setErrors(fresh.errors as Partial<Record<keyof T, unknown>>);
      setPending(false);
      return Object.keys(fresh.errors).length === 0;
    });
  }, []);

  // deps 是调用方写的数组字面量，每帧都是新引用，直接当依赖会让首屏请求每帧重发；
  // 序列化成字符串才能比出「真的变了」。
  const depsKey = JSON.stringify(deps);
  const refreshKey = JSON.stringify(refreshDeps);

  /**
   * 上一次的依赖指纹。`context` 初值取 null，于是首屏一定算出 initial ——
   * 不需要在挂载时额外补一次请求；`query` 初值取当前值，挂载时不该因为
   * 「查询范围从无到有」而多打一次。
   */
  const prints = useRef<DepPrints>({ context: null, query: refreshKey });

  useEffect(() => {
    const next: DepPrints = { context: depsKey, query: refreshKey };
    const mode = depMode(prints.current, next);
    prints.current = next;
    if (mode) void run(mode);
  }, [depsKey, refreshKey, run]);

  const reload = useCallback(() => run("refresh"), [run]);

  return {
    values,
    errors,
    ...asyncFlags(values, errors, pending),
    reload,
  };
}
