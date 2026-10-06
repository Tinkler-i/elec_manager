import { NextResponse, type NextRequest } from "next/server";

import { currentVersion, isNewer } from "@/lib/version";
import type { UpdateInfo } from "@/types";

/**
 * 更新检查。
 *
 * 只查「有没有新版」，不下载、不安装 —— 装新版本仍然由飞牛应用中心完成
 * （应用没有安装应用的权限，开放 API 第一期也没有这类能力）。
 *
 * 为什么走 api.github.com 而不是 github.com 的 `releases/latest` 重定向：
 * 实测本机到 github.com:443 直连超时，api.github.com 正常（659ms）。重定向那招
 * 依赖网页域名，这条网络下不可用。
 *
 * 匿名配额 60 次/小时，所以结果在服务端缓存 30 分钟；前端点「检查更新」时带
 * `?force=1` 绕过缓存。配了 GITHUB_TOKEN 环境变量则配额提到 5000 次/小时。
 */

const REPO = process.env.ELEC_UPDATE_REPO || "Tinkler-i/elec_manager";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

const CACHE_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;

let cache: { at: number; info: UpdateInfo } | null = null;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force") === "1";
  const current = currentVersion();

  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ ...cache.info, cached: true });
  }

  const info = await checkLatest(current);
  // 只缓存成功的结果：失败（网络不通、限流）下次应当重新试
  if (!info.error) cache = { at: Date.now(), info };

  return NextResponse.json(info);
}

async function checkLatest(current: string): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    current,
    latest: null,
    hasUpdate: false,
    releaseUrl: RELEASES_PAGE,
    publishedAt: null,
    notes: null,
    checkedAt: new Date().toISOString(),
    cached: false,
    error: null,
  };

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": `elec-meter/${current}`,
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const res = await fetch(RELEASES_API, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) {
      // GitHub 对「仓库不存在 / 私有」和「仓库存在但一个 Release 都没有」都返回 404，
      // 从响应里分不出来，文案把两种可能都说上
      return { ...base, error: "仓库不存在，或还没有发布任何 Release（HTTP 404）" };
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      return {
        ...base,
        error:
          remaining === "0"
            ? "GitHub 接口的匿名配额用完了（60 次/小时），过一会儿再试"
            : `GitHub 拒绝了请求（HTTP ${res.status}）`,
      };
    }
    if (!res.ok) {
      return { ...base, error: `GitHub 返回 HTTP ${res.status}` };
    }

    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
      body?: string;
    };

    const latest = data.tag_name ?? null;
    return {
      ...base,
      latest,
      // 解析不出 tag 时 hasUpdate 保持 false，但 latest 仍显示出来，
      // 免得用户以为「没有新版」
      hasUpdate: latest ? isNewer(latest, current) : false,
      releaseUrl: data.html_url || RELEASES_PAGE,
      publishedAt: data.published_at ?? null,
      notes: data.body ? data.body.trim().slice(0, 600) : null,
    };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    const code = (e as { cause?: { code?: string } })?.cause?.code;
    return {
      ...base,
      error:
        name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT"
          ? "连接 GitHub 超时，设备到 github.com 的网络可能不通"
          : "连接 GitHub 失败",
    };
  }
}
