"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gauge, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi, errText } from "@/lib/api";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      // 提交值以表单元素的实际值为准，而不是 React state。
      // 浏览器自动填充直接改写 DOM 的 value、不派发 input 事件，受控组件的
      // onChange 收不到 —— 界面显示有值、state 还是空串，用户只会看到
      // "密码错误"并反复重试。
      const form = e.currentTarget as HTMLFormElement;
      const domValue =
        (form.elements.namedItem("password") as HTMLInputElement | null)?.value ?? "";
      const finalPassword = domValue || password;

      if (!finalPassword) {
        toast.error("请输入密码");
        return;
      }

      await authApi.login(finalPassword, remember);
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Gauge className="size-5" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-[-0.01em]">电表数据管理系统</h1>
          <p className="text-xs text-muted-foreground">记录读数、统计用电与费用</p>
        </div>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                autoFocus
                required
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="size-3.5 accent-[var(--primary)]"
              />
              保持登录状态（365 天）
            </label>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="animate-spin" /> : <LogIn />}
              {loading ? "登录中..." : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">忘记密码请联系管理员</p>
    </div>
  );
}
