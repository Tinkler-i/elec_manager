import { ChartLine, Coins, Gauge, Zap } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { UsageChart } from "@/components/charts/usage-chart";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRatePerKwh, getReadings, getStats } from "@/lib/db";
import { fmtKwh, fmtMoney, fmtNumber } from "@/lib/format";

/**
 * 读数据库的页面必须显式声明动态渲染。
 *
 * 页面里没有 `cookies()` / `headers()` / `searchParams` 这类动态 API，Next 默认
 * 会把它静态预渲染 —— `better-sqlite3` 读出来的数据会在 build 时被烤进 HTML，
 * 上线后仪表盘永远停在构建那一刻，而且本地测试完全看不出问题。
 */
export const dynamic = "force-dynamic";

/** 停留期间自动刷新；标签页隐藏时跳过、切回来立即刷一次（见 use-heartbeat） */
const REFRESH_MS = 30_000;

/**
 * 仪表盘。
 *
 * 数据在服务端取好再渲染，首屏 HTML 里就是最终数字，所以没有「客户端加载中」
 * 这一态 —— 加载态交给根段的 loading.tsx。取数抛错会冒到 src/app/error.tsx，
 * 不会被渲染成「暂无数据」。
 *
 * 原来这里是三个接口并发（统计 / 读数 / 设置），现在同一个渲染里串行查
 * SQLite（同步 API）。请求量小，代价可接受，换来的是首屏就有数据。
 */
export default function DashboardPage() {
  const stats = getStats();
  const readings = getReadings();
  const rate = getRatePerKwh();

  return (
    <div className="space-y-5">
      <AutoRefresh intervalMs={REFRESH_MS} />

      <PageHeader
        title="仪表盘"
        description={`共 ${fmtNumber(stats.totalReadings, 0)} 条读数 · 单价 ${fmtMoney(rate)}/度`}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="本月用电"
          value={`${fmtKwh(stats.currentMonthConsumed)} 度`}
          icon={Zap}
          tone="accent"
        />
        <StatCard
          label="本月费用"
          value={fmtMoney(stats.currentMonthAmount)}
          icon={Coins}
          tone="accent"
        />
        <StatCard label="累计用电" value={`${fmtKwh(stats.totalConsumed)} 度`} icon={Gauge} />
        <StatCard label="累计费用" value={fmtMoney(stats.totalAmount)} icon={ChartLine} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>用电趋势</CardTitle>
          <p className="text-xs text-muted-foreground">最近 6 个月的日均用电量</p>
        </CardHeader>
        <CardContent>
          {readings.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title="还没有读数记录"
              description="去「读数记录」添加第一条，趋势图就会出现在这里。"
            />
          ) : (
            <UsageChart readings={readings} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
