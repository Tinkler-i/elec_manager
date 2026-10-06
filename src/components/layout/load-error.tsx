"use client";

import { TriangleAlert, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { errText } from "@/lib/api";

/**
 * 首屏取数失败的错误态。
 *
 * 必须给出「重试」，而且要把失败原因原样显示出来：原来失败只 `console.error`，
 * 界面上是一句「暂无数据」，用户既不知道出了什么事，也没有任何可做的事。
 */
export function LoadError({
  error,
  onRetry,
  className = "py-12",
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${className}`}>
      <div className="grid size-10 place-items-center rounded-full bg-destructive/10">
        <TriangleAlert className="size-5 text-destructive" />
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">数据加载失败</div>
        <div className="max-w-md text-xs text-muted-foreground">{errText(error)}</div>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="size-3.5" />
          重试
        </Button>
      ) : null}
    </div>
  );
}
