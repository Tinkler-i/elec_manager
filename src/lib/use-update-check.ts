"use client";

import { updateApi } from "@/lib/api";
import { useAsyncAll } from "@/lib/use-async-data";
import type { UpdateInfo } from "@/types";

/**
 * 有没有新版本。
 *
 * 单独抽出来是因为两个地方要用：设置页的「关于」面板，以及底栏「设置」图标上的
 * 小圆点。结果在服务端缓存 30 分钟，所以每个页面挂一次实际只是一次本地请求，
 * 不会每次都打 GitHub。
 *
 * 检查失败时返回 null —— 调用方据此不显示任何提示。「查不到」和「确认没有新版」
 * 是两件事，不能把前者显示成后者。
 */
export function useUpdateCheck(): UpdateInfo | null {
  const { values } = useAsyncAll({ info: () => updateApi.check() });
  return values.info ?? null;
}
