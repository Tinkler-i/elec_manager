"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { authApi } from "@/lib/api";

/** 不需要登录就能访问的路径。与 src/proxy.ts 的 PUBLIC_PATHS 保持一致。 */
const PUBLIC_PATHS = ["/login"];

/**
 * 客户端登录守卫。
 *
 * **不阻塞首屏渲染。** 真正的拦截在 `src/proxy.ts`：它校验 JWT，未登录的请求
 * 根本拿不到页面 HTML（307 到 /login）。也就是说能渲染到这里，服务端已经确认
 * 过身份了 —— 再在客户端等一次 `/api/auth/check` 才渲染，只会让每次进页面都
 * 先闪一下骨架。
 *
 * 这里只保留兜底：会话在页面停留期间失效（改密码、换设备、token 过期）时把人
 * 送回登录页。它和 lib/api.ts 的 401 拦截器是同一件事的两道保险，谁先发现都行。
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    // 公开页不校验：在 /login 上校验必然 401，然后把人往 /login 推，
    // 是在自己踢自己。
    if (isPublic) return;

    // 组件已卸载 / 已切走时不再写状态，避免对已失效的树 setState
    let cancelled = false;

    authApi.check().catch(() => {
      if (cancelled) return;
      setAuthenticated(false);
      router.replace("/login");
    });

    return () => {
      cancelled = true;
    };
  }, [isPublic, router]);

  if (isPublic) return <>{children}</>;
  if (!authenticated) return null;
  return <>{children}</>;
}
