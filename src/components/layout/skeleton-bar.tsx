import { cn } from "@/lib/utils";

/**
 * 骨架条。
 *
 * 首屏未就绪时用它占位，而不是一句「加载中...」——文字会把内容区撑成一行，
 * 数据到达时整块跳一下；骨架保持住版式，内容落地时只是替换而不是重排。
 */
export function SkeletonBar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

/** 若干行等高骨架，用于表格/列表的加载态 */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBar key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
