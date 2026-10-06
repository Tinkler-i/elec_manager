"use client";

import { useRouter } from "next/navigation";

import { useHeartbeat } from "@/lib/use-heartbeat";

/**
 * 服务端取数页面的自动刷新。
 *
 * 页面本身是服务端组件、数据在服务端取好，所以刷新不能再走客户端 fetch ——
 * 这里只按时让 Next 重新跑一遍服务端渲染（`router.refresh()` 会重新请求 RSC
 * 内容并就地替换，客户端组件自身的 state 不受影响）。
 *
 * 不直接用 `setInterval` 而走 `useHeartbeat`：它已经处理了「标签页隐藏时跳过」
 * 和「切回来立即刷一次」，与迁移前客户端轮询的行为一致。
 *
 * 渲染 null，放在页面树里任意位置即可。
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useHeartbeat(() => router.refresh(), intervalMs);
  return null;
}
