"use client";

import { useEffect, useRef } from "react";

/**
 * 心跳刷新：页面停留期间按固定间隔重新拉取数据。
 *
 * 改自 workbuddy-manager（MIT）的 `web/lib/use-heartbeat.ts`。两个细节：
 *  · 标签页不可见时跳过刷新（浏览器本来也会把定时器节流到约 1 次/分钟，
 *    与其让它零星触发，不如明确跳过）；
 *  · 重新切回该标签页时立即刷新一次，避免看到切走之前的旧数据。
 */
export function useHeartbeat(fn: () => void, ms: number) {
  // 用 ref 保存最新回调，这样 fn 每次渲染变化都不会重建定时器。
  // 赋值放在 effect 里而不是渲染期：React 19 的 lint 规则不允许渲染期写 ref，
  // 而且渲染期写 ref 在并发渲染下可能写入一次被丢弃的渲染结果。
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) ref.current();
    };
    const timer = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms]);
}
