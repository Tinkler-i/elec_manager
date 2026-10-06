import { SkeletonBar } from "@/components/layout/skeleton-bar";

/**
 * 根段加载态。
 *
 * 页面改成服务端取数之后，页面内部不再有「客户端加载中」这一态 —— 首屏 HTML
 * 里已经是最终数据。用户等待的那段时间由这里承接：Next 会先把布局与这块骨架
 * 流式发给浏览器，服务端渲染完成后再替换成真正的页面。
 *
 * 刻意写得通用（标题 + 一排卡片 + 一块内容区），因为这个文件挂在根段上，
 * `/`、`/analytics` 以及以后任何流式渲染的页面都会用到它。静态预渲染的页面
 * 不会显示它（HTML 里已经带内容），所以不会让 /readings、/settings 闪一下。
 */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <SkeletonBar className="h-7 w-40" />
        <SkeletonBar className="h-4 w-64" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBar key={i} className="h-24 w-full" />
        ))}
      </div>

      <SkeletonBar className="h-[280px] w-full" />
      <span className="sr-only">正在加载</span>
    </div>
  );
}
