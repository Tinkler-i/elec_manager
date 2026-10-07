"use client";

import { useState, useSyncExternalStore } from "react";
import {
  BookOpen,
  Check,
  Copy,
  KeyRound,
  Pencil,
  Plug,
  Server,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
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
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errText, mcpApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useAsyncAll } from "@/lib/use-async-data";
import type { McpKeyCreated, McpKeyInfo } from "@/types";

/* ── 密钥 ───────────────────────────────────────────────────────────────── */

/** 备注长度上限。后端超了返 400，这里先挡一道，别让用户白填 */
const NOTE_MAX = 64;
/** 密钥把数上限。后端超了返 400 */
const KEY_LIMIT = 20;

/* ── 页头用的站点源 ─────────────────────────────────────────────────────── */

/**
 * 站点源。页面存活期间不会变，所以不需要订阅任何东西。
 *
 * 三个快照函数必须定义在模块级：写成内联箭头函数的话每次渲染都是新引用，
 * useSyncExternalStore 会反复重新订阅。
 */
const subscribeOrigin = () => () => {};
const getOriginSnapshot = () => window.location.origin;
const getOriginServerSnapshot = () => "";

/** 待确认的破坏性操作。吊销全部要单独一档，确认文案也更重 */
type PendingConfirm = { kind: "revoke"; info: McpKeyInfo } | { kind: "revoke-all" } | null;

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
    keys: mcpApi.listKeys,
  });

  const [copied, setCopied] = useState<string | null>(null);

  /**
   * 刚生成的密钥明文。
   *
   * 只在生成那一次有值 —— 库里存的是 SHA-256 哈希，刷新页面就再也拿不回来了。
   * 所以它不进 useAsyncAll（那会被后续刷新覆盖），而是单独一个 state；页面刷新
   * 后它自然是 null，明文不会再出现。
   */
  const [generated, setGenerated] = useState<McpKeyCreated | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);

  /**
   * 站点源（形如 `https://host:port`）。
   *
   * 渲染期不能直接读 `window`：SSR 时它是 undefined、客户端首帧却有值，两边渲染
   * 出的 HTML 不同，React 19 会报水合不一致。
   *
   * 用 useSyncExternalStore 而不是 useState + useEffect：服务端快照是空串，
   * 水合阶段 React 用的也是它，水合完成后发现客户端快照不同才重渲染 —— 首帧
   * 两边必然一致。写成 effect 里 setState 会被 react-hooks/set-state-in-effect
   * 拦下（cascading render），这里也顺带避开了。
   */
  const origin = useSyncExternalStore(subscribeOrigin, getOriginSnapshot, getOriginServerSnapshot);

  const keys = values.keys?.keys ?? [];
  // 还没拿到、也还没报错 = 首次加载中。不能只看页级的 isInitialLoading：
  // tools 先回来时它就已经是 false 了，那会闪一下「还没有密钥」的假空态。
  const keysLoading = values.keys === undefined && !errors.keys;
  const atLimit = keys.length >= KEY_LIMIT;

  async function createKey() {
    if (busy || atLimit) return;
    setBusy(true);
    try {
      const result = await mcpApi.createKey(noteDraft.trim() || undefined);
      // 明文只在这里落一次 state，刷新即消失
      setGenerated(result);
      setNoteDraft("");
      toast.success("已生成新密钥");
      await reload();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      // 清空备注要显式传 null —— 后端把「缺 note 字段」当成 400，不当成清空
      const note = editDraft.trim();
      await mcpApi.updateKeyNote(id, note === "" ? null : note);
      setEditingId(null);
      toast.success("备注已更新");
      await reload();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await mcpApi.revokeKey(id);
      // 吊销的正好是刚生成那把：明文留着会误导，一起清掉
      setGenerated((prev) => (prev?.info.id === id ? null : prev));
      toast.success("已吊销该密钥");
      await reload();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function revokeAllKeys() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await mcpApi.revokeAllKeys();
      setGenerated(null);
      setEditingId(null);
      toast.success(`已吊销 ${result.revoked} 把密钥`);
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
  const mcpUrl = `${origin}/api/mcp`;

  const httpConfig = JSON.stringify(
    {
      mcpServers: {
        "elec-meter": {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${generated?.key ?? "<你的 MCP 密钥>"}` },
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
                  <CardDescription>
                    独立于登录会话。每把可带备注区分用途；吊销后，用它的客户端会立刻失效。
                  </CardDescription>
                </div>
                {keys.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => setConfirm({ kind: "revoke-all" })}
                  >
                    <Trash2 />
                    吊销全部
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {generated ? (
                <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="size-4" />
                    只显示这一次，关闭或刷新后无法再查看
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="hide-scrollbar min-w-0 flex-1 overflow-x-auto rounded-md bg-background/70 px-3 py-2 font-mono text-xs">
                      {generated.key}
                    </code>
                    <CopyButton text={generated.key} label="密钥" copied={copied} onCopy={copyText} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {generated.info.note ? `备注：${generated.info.note} · ` : ""}
                      库里只存 SHA-256 哈希，明文连服务端也拿不回来。
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setGenerated(null)}>
                      我已保存
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createKey();
                    }}
                    placeholder="备注，例如「家里那台 NAS」（可选）"
                    aria-label="新密钥的备注"
                    maxLength={NOTE_MAX}
                    disabled={busy || atLimit}
                  />
                  <Button
                    className="shrink-0"
                    onClick={() => void createKey()}
                    disabled={busy || atLimit}
                  >
                    <KeyRound />
                    生成密钥
                  </Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>备注最多 {NOTE_MAX} 个字符，留空则显示「未命名」</span>
                  <span>
                    {keys.length} / {KEY_LIMIT} 把
                  </span>
                </div>
                {atLimit ? (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    已经到 {KEY_LIMIT} 把上限了。先吊销不用的，再建新的。
                  </p>
                ) : null}
              </div>

              {keysLoading ? (
                <div className="space-y-2">
                  <SkeletonBar className="h-16 w-full" />
                  <SkeletonBar className="h-16 w-full" />
                </div>
              ) : errors.keys ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
                  <div className="font-medium text-destructive">密钥列表没取到</div>
                  <div className="mt-1 text-muted-foreground">{errText(errors.keys)}</div>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => void reload()}>
                    重试
                  </Button>
                </div>
              ) : keys.length === 0 ? (
                <EmptyState
                  icon={KeyRound}
                  title="还没有独立密钥"
                  description="生成之后 MCP 客户端就用它接入，与你的登录会话彻底分开 —— 网页登出、改密码都不会影响它。建议给每把起个备注，方便日后分辨该吊销哪一把。"
                  className="py-8"
                />
              ) : (
                <ul className="space-y-2">
                  {keys.map((info) => (
                    <KeyRow
                      key={info.id}
                      info={info}
                      editing={editingId === info.id}
                      draft={editDraft}
                      busy={busy}
                      onStartEdit={() => {
                        setEditingId(info.id);
                        setEditDraft(info.note ?? "");
                      }}
                      onDraftChange={setEditDraft}
                      onSave={() => void saveNote(info.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onRevoke={() => setConfirm({ kind: "revoke", info })}
                    />
                  ))}
                </ul>
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
        title={confirm?.kind === "revoke-all" ? "吊销全部 MCP 密钥" : "吊销这把 MCP 密钥"}
        description={
          confirm?.kind === "revoke-all" ? (
            <>
              会立刻吊销全部 <strong>{keys.length}</strong> 把密钥。所有已经配好的 MCP 客户端会
              <strong>同时断开</strong>，必须逐台重新配置。这个操作不可撤销。
            </>
          ) : confirm?.kind === "revoke" ? (
            <>
              即将吊销「
              <strong>{confirm.info.note?.trim() || "未命名"}</strong>
              」。正在使用这把密钥的 MCP 客户端会立刻失效，需要改用其它密钥。
            </>
          ) : undefined
        }
        confirmLabel={confirm?.kind === "revoke-all" ? "全部吊销" : "吊销"}
        destructive
        busy={busy}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "revoke-all") void revokeAllKeys();
          else void revokeKey(confirm.info.id);
        }}
      />
    </div>
  );
}

/**
 * 列表里的一行密钥。
 *
 * 必须是模块级组件：写在页面组件里等于每次渲染都新建一个组件类型，React 会把它
 * 当成另一个组件卸载重建（就地编辑时输入框会丢焦点）。
 */
function KeyRow({
  info,
  editing,
  draft,
  busy,
  onStartEdit,
  onDraftChange,
  onSave,
  onCancelEdit,
  onRevoke,
}: {
  info: McpKeyInfo;
  editing: boolean;
  draft: string;
  busy: boolean;
  onStartEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onRevoke: () => void;
}) {
  const note = info.note?.trim();

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {editing ? (
            <Input
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
                if (e.key === "Escape") onCancelEdit();
              }}
              aria-label="备注"
              placeholder="备注（可留空）"
              maxLength={NOTE_MAX}
              disabled={busy}
            />
          ) : (
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <span
                className={`truncate text-sm font-medium ${note ? "" : "text-muted-foreground"}`}
              >
                {note || "未命名"}
              </span>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            创建于 {fmtDateTime(info.createdAt)} ·{" "}
            {info.lastUsedAt ? `最后使用 ${fmtDateTime(info.lastUsedAt)}` : "从未使用"}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          {editing ? (
            <>
              <Button size="sm" disabled={busy} onClick={onSave}>
                <Check />
                保存
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onCancelEdit}>
                <X />
                取消
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onStartEdit}>
                <Pencil />
                改备注
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={onRevoke}
              >
                <Trash2 />
                吊销
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
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
