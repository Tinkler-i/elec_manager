import type { ReactNode } from "react";

/**
 * 页面标题区。
 *
 * 抽出来的原因：五个页面原来各写一遍 `<h1 className="text-2xl font-bold text-gray-900">`，
 * 而 `text-gray-900` 在暗色下是黑底黑字 —— 这正是不该在页面里写死颜色的理由。
 * 标题、说明、右侧操作三者的间距与对齐也统一在这里。
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-foreground sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="text-xs text-muted-foreground sm:text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
