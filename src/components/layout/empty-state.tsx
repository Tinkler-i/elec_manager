import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * 空态。
 *
 * 和「加载中」必须分开：取数失败时显示「暂无数据」是在撒谎 —— 数据是没取到，
 * 不是没有。空态只用于「请求成功、结果确实是空的」。
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "py-12",
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-center ${className}`}>
      {Icon ? (
        <div className="grid size-10 place-items-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </div>
      ) : null}
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description ? (
        <div className="max-w-sm text-xs text-muted-foreground">{description}</div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
