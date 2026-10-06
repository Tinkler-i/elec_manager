"use client";

import { useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  KeyRound,
  Plug,
  RotateCw,
  Server,
  Terminal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadError } from "@/components/layout/load-error";
import { PageHeader } from "@/components/layout/page-header";
import { SkeletonBar } from "@/components/layout/skeleton-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errText, mcpApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useAsyncAll } from "@/lib/use-async-data";

/**
 * MCP 服务页。
 *
 * 三个 Tab：远程 HTTP 接入、本地 stdio 接入、工具清单。工具清单来自
 * `/api/mcp/tools`（后端从 mcp-tools.ts 导出），所以这里不会出现"文档写了
 * 但实际没有"的工具。
 */
export default function McpPage() {
  const { values, errors, isInitialLoading, isInitialFailed, reload } = useAsyncAll({
    tools: mcpApi.tools,
    keyStatus: mcpApi.keyStatus,
  });

  const [copied, setCopied] = useState<string | null>(null);

  /**
   * 刚生成的密钥明文。
   *
   * 只在生成那一次有值 —— 库里存的是 SHA-256 哈希，刷新页面就再也拿不回来了。
   * 所以它不进 useAsyncAll（那会被后续刷新覆盖），而是单独一个 state，界面上也
   * 明确写「只显示这一次」。
   */
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"reset" | "revoke" | null>(null);

  const keyStatus = values.keyStatus ?? { configured: false, createdAt: null, lastUsedAt: null };

  async function generateKey() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await mcpApi.generateKey();
      setGeneratedKey(result.key);
      toast.success("已生成新密钥");
      await reload();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function revokeKey() {
    if (busy) return;
    setBusy(true);
    try {
      await mcpApi.revokeKey();
      setGeneratedKey(null);
      toast.success("已吊销密钥");
      await reload();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard API 在非 HTTPS / 无权限时会抛错，提示里给出可用的替代做法
      toast.error("复制失败，请手动选中复制");
    }
  }

  if (isInitialFailed) {
    return (
      <>
        <PageHeader title="MCP 服务" />
        <LoadError className="py-24" error={errors.tools} onRetry={reload} />
      </>
    );
  }

  const tools = values.tools?.tools ?? [];
  const baseUrl = typeof window === "undefined" ? "" : `${window.location.protocol}//${window.location.host}`;
  const mcpUrl = `${baseUrl}/api/mcp`;

  const httpConfig = JSON.stringify(
    {
      mcpServers: {
        "elec-meter": {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${generatedKey ?? "<你的 MCP 密钥>"}` },
        },
      },
    },
    null,
    2,
  );

  const stdioConfig = JSON.stringify(
    {
      mcpServers: {
        "elec-meter": {
          command: "npx",
          args: ["tsx", "/path/to/elec/mcp-server.ts"],
          env: { ELEC_DB_PATH: "/path/to/data/elec.db" },
        },
      },
    },
    null,
    2,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="MCP 服务"
        description="让 AI 客户端直接读写电表数据"
        actions={
          <Badge variant="outline">
            <Plug />
            {isInitialLoading ? "…" : `${tools.length} 个工具`}
          </Badge>
        }
      />

      <Tabs defaultValue="streamable">
        <TabsList>
          <TabsTrigger value="streamable">
            <Server className="size-4" />
            Streamable HTTP
          </TabsTrigger>
          <TabsTrigger value="stdio">
            <Terminal className="size-4" />
            Stdio
          </TabsTrigger>
          <TabsTrigger value="tools">
            <BookOpen className="size-4" />
            工具列表
          </TabsTrigger>
        </TabsList>

        <TabsContent value="streamable" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Streamable HTTP 连接</CardTitle>
              <CardDescription>适用于支持远程 MCP 服务器的 AI 客户端</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="MCP 端点">
                <code className="hide-scrollbar min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                  {mcpUrl || "加载中..."}
                </code>
                <CopyButton text={mcpUrl} label="端点" copied={copied} onCopy={copyText} />
              </Field>

              <p className="text-xs text-muted-foreground">
                请求头需带{" "}
                <code className="rounded bg-muted px-1 font-mono">
                  Authorization: Bearer &lt;MCP 密钥&gt;
                </code>
                。也接受当前登录会话的 JWT，方便在浏览器里调试。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>MCP 密钥</CardTitle>
                  <CardDescription>独立于登录会话，可随时重新生成</CardDescription>
                </div>
                {keyStatus.configured ? (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirm("reset")}>
                      <RotateCw />
                      重新生成
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => setConfirm("revoke")}
                    >
                      <Trash2 />
                      吊销
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" disabled={busy} onClick={generateKey}>
                    <KeyRound />
                    生成密钥
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {generatedKey ? (
                <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="size-4" />
                    只显示这一次，请立刻保存到 MCP 客户端
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="hide-scrollbar min-w-0 flex-1 overflow-x-auto rounded-md bg-background/70 px-3 py-2 font-mono text-xs">
                      {generatedKey}
                    </code>
                    <CopyButton text={generatedKey} label="密钥" copied={copied} onCopy={copyText} />
                  </div>
                </div>
              ) : keyStatus.configured ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">已配置</div>
                  <div className="mt-1">
                    创建于 {keyStatus.createdAt ? fmtDateTime(keyStatus.createdAt) : "未知"} · 最后使用{" "}
                    {keyStatus.lastUsedAt ? fmtDateTime(keyStatus.lastUsedAt) : "从未"}
                  </div>
                  <div className="mt-1">
                    库里只存 SHA-256 哈希，明文连服务端也拿不回来 —— 忘了就「重新生成」。
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  还没有独立密钥。生成之后 MCP 客户端就用它接入，与你的登录会话彻底分开 ——
                  网页登出、改密码都不会影响它。
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>客户端配置示例</CardTitle>
              <CardDescription>Claude Desktop / Cursor / Windsurf</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2">
                <pre className="hide-scrollbar min-w-0 flex-1 overflow-auto rounded-lg bg-muted p-4 font-mono text-xs">
                  {httpConfig}
                </pre>
                <CopyButton text={httpConfig} label="HTTP 配置" copied={copied} onCopy={copyText} />
              </div>
              <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-300">
                如果前面挂了反向代理，端点 URL 要换成外网可访问的地址，Token 保持不变。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stdio" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Stdio 本地连接</CardTitle>
              <CardDescription>AI 客户端与数据库在同一台机器上时用这个</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="运行命令">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                  npx tsx mcp-server.ts
                </code>
                <CopyButton
                  text="npx tsx mcp-server.ts"
                  label="命令"
                  copied={copied}
                  onCopy={copyText}
                />
              </Field>

              <div className="space-y-2">
                <div className="text-sm font-medium">环境变量</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>变量名</TableHead>
                      <TableHead>说明</TableHead>
                      <TableHead>默认值</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>
                        <code className="font-mono text-xs">ELEC_DB_PATH</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground">SQLite 数据库文件路径</TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">data/elec.db</code>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>客户端配置示例</CardTitle>
              <CardDescription>Claude Desktop / Cursor / Windsurf</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-2">
                <pre className="hide-scrollbar min-w-0 flex-1 overflow-auto rounded-lg bg-muted p-4 font-mono text-xs">
                  {stdioConfig}
                </pre>
                <CopyButton text={stdioConfig} label="Stdio 配置" copied={copied} onCopy={copyText} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools">
          <Card>
            <CardHeader>
              <CardTitle>可用工具 {isInitialLoading ? "" : `(${tools.length})`}</CardTitle>
              <CardDescription>参数与必填项由服务端定义实时导出</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isInitialLoading ? (
                <>
                  <SkeletonBar className="h-20 w-full" />
                  <SkeletonBar className="h-20 w-full" />
                </>
              ) : tools.length === 0 ? (
                <EmptyState icon={BookOpen} title="暂无可用工具" />
              ) : (
                tools.map((tool) => (
                  <div key={tool.name} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">
                        {tool.name}
                      </code>
                      <Badge variant="secondary">{tool.title}</Badge>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">{tool.description}</p>

                    {tool.parameters.properties && Object.keys(tool.parameters.properties).length > 0 ? (
                      <Table className="mt-3">
                        <TableHeader>
                          <TableRow>
                            <TableHead>参数名</TableHead>
                            <TableHead>类型</TableHead>
                            <TableHead>说明</TableHead>
                            <TableHead>必填</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(tool.parameters.properties).map(([key, prop]) => (
                            <TableRow key={key}>
                              <TableCell>
                                <code className="font-mono text-xs">{key}</code>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{prop.type}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{prop.description}</TableCell>
                              <TableCell>
                                {tool.parameters.required?.includes(key) ? (
                                  <Badge variant="destructive">必填</Badge>
                                ) : (
                                  <Badge variant="secondary">可选</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "revoke" ? "吊销 MCP 密钥" : "重新生成 MCP 密钥"}
        description={
          confirm === "revoke"
            ? "吊销后，所有用这个密钥的 MCP 客户端会立刻断开，需要重新配置。"
            : "重新生成后，旧密钥立刻失效，所有已配置的 MCP 客户端都要换成新的。"
        }
        confirmLabel={confirm === "revoke" ? "吊销" : "重新生成"}
        destructive={confirm === "revoke"}
        onConfirm={confirm === "revoke" ? revokeKey : generateKey}
      />
    </div>
  );
}

/**
 * 复制按钮。
 *
 * 必须是模块级组件：写在页面组件里等于每次渲染都新建一个组件类型，React 会
 * 把它当成另一个组件卸载重建（输入焦点、内部状态全丢），React 19 的 lint
 * 规则也会直接报 "Cannot create components during render"。
 */
function CopyButton({
  text,
  label,
  copied,
  onCopy,
}: {
  text: string;
  label: string;
  copied: string | null;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={`复制${label}`}
      onClick={() => onCopy(text, label)}
    >
      {copied === label ? <Check className="text-emerald-600 dark:text-emerald-400" /> : <Copy />}
    </Button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
