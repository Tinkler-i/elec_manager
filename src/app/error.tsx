"use client";

import { LoadError } from "@/components/layout/load-error";

/**
 * 路由级错误边界。
 *
 * 服务端取数抛错时，没有这个文件 Next 会渲染它自己的错误页；而带
 * `force-dynamic` 的页面必须让用户看见「失败了」并且能重试。这里的关键是
 * **不能让故障退化成空态** —— 「暂无数据」是「请求成功、结果确实为空」的语义，
 * 用它承接异常等于把故障伪装成正常。
 *
 * 用 `unstable_retry` 而不是 `reset`：Next 16 里 `reset` 只重渲染子树、不重新
 * 取数，服务端那次失败会原样复现；`unstable_retry` 会重新请求并重渲染。
 * 见 node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md。
 *
 * 生产环境里服务端错误的 `error.message` 会被替换成通用文案，`digest` 是唯一
 * 能和服务端日志对上的标识，所以把它显示出来，方便定位。
 */
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <LoadError error={error} onRetry={unstable_retry} className="py-24" />
      {error.digest ? (
        <p className="text-xs text-muted-foreground">错误编号 {error.digest}</p>
      ) : null}
    </div>
  );
}
