"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const PUBLIC_PATHS = ["/login"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (PUBLIC_PATHS.includes(pathname)) {
      setLoading(false);
      return;
    }

    checkAuth();
  }, [pathname]);

  async function checkAuth() {
    try {
      const response = await fetch("/api/auth/check");
      if (response.ok) {
        setAuthenticated(true);
      } else {
        router.push("/login");
      }
    } catch {
      router.push("/login");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (PUBLIC_PATHS.includes(pathname) || authenticated) {
    return <>{children}</>;
  }

  return null;
}
