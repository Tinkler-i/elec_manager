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
import { MAX_BODY_BYTES, MAX_KEYS, MAX_NOTE_LENGTH } from "@/lib/mcp-key-limits";
import { useAsyncAll } from "@/lib/use-async-data";
import type { McpKeyCreated, McpKeyInfo } from "@/types";

/* ── 密钥 ───────────────────────────────────────────────────────────────── */

/**
 * 三个上限全部来自 `@/lib/mcp-key-limits` —— **前后端同一份定义**，别在这里再抄一遍数字。
 *
 * 它们是三种不同的约束，前端三个都要查：
 *  · `MAX_NOTE_LENGTH` —— 产品约束，按**字素簇**算
 *  · `MAX_BODY_BYTES`  —— 传输约束，按 **UTF-8 字节**算
 *  · `MAX_KEYS`        —— 数量约束（到顶就该先禁用「生成」，而不是让用户点完再吃 400）
 *
 * **前两个互相保证不了。** 一个「字符」里可以塞任意多个组合记号（`a` 后面跟 64 个
 * U+0301 仍然只算 1 个字素簇），所以 64 个字素簇**可能**远超 8 KiB。只查字素簇就会出现
 * 「界面显示 64 / 64、按钮可用」→ 提交 → 后端 400 —— 一句用户看得见的谎。
 *
 * 另外别用 `maxLength` 属性来挡长度：HTML 的 maxLength 数的是 UTF-16 码元，一个 😀 算 2、
 * 一个带 ZWJ 的 🧑‍🚀 算 7，用户想输 64 个 emoji 会在 32 个就被截断。
 */

/**
 * 数备注长度。规则与后端 `Intl.Segmenter('zh', { granularity: 'grapheme' })` 一致。
 *
 * 先 `trim()` 再数：后端存之前也会 trim，所以这里算的就是**实际会被提交的那个值**，
 * 计数显示和后台的判断不会差一个空格。
 *
 * `Intl.Segmenter` 在 Node 18+ 和现代浏览器里都有。万一没有（老运行时），退回
 * `Array.from(...).length` —— 它按码点迭代，代理对（单个 emoji）算 1 个是对的，但会把
 * ZWJ 组合序列拆开多算（🧑‍🚀 算 3 而不是 1）。这是**偏保守**的降级：宁可少数复杂 emoji
 * 被多算，也不要因为构造函数不存在就白屏。构造函数在模块加载时探一次，不在渲染里试。
 *
 * 所以这里返回两样东西：`count` 是计数器，`exact` 说明它是不是真的按字素簇算。
 * **提示文案要跟着 `exact` 改口** —— 一边按码点算、一边告诉用户「一个 emoji 算 1 个」，
 * 就是在骗人。
 *
 * ⚠️ **跨引擎不保证一致。** 切分结果取决于引擎自带的 Unicode 数据，QA 实测 Node 与
 * Chromium 在 37,928 条样本里有 2,456 条不同（最小复现 `🗩\u200D🗩`：Node 算 1、Chromium
 * 算 2；方向上通常是前端多算、更严，但 Firefox / Safari 没验过）。所以**前端这道 gate
 * 是提示、不是保证**，最终判定在后端 —— 文案里别承诺「一定算得一样」。
 *
 * SSR 和客户端用的是同一个实现、同一个输入，算出的数必然相同，不会引入水合不一致。
 */
const graphemeCounter = ((): { count: (text: string) => number; exact: boolean } => {
  try {
    const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
    return { count: (text) => [...segmenter.segment(text)].length, exact: true };
  } catch {
    return { count: (text) => Array.from(text).length, exact: false };
  }
})();

/** 备注长度（trim 后）。空串是 0 */
const noteLength = (text: string) => graphemeCounter.count(text.trim());

/** 长度单位说明。降级成按码点算时不能再说「一个 emoji 算 1 个」 */
const NOTE_UNIT_HINT = graphemeCounter.exact ? "（一个 emoji 算 1 个）" : "（按码点算）";

/**
 * 算出**真正会发出去的那个请求体**有多少 UTF-8 字节。
 *
 * 形状必须与 `api.ts` 里 `mcpApi.createKey` / `updateKeyNote` 构造的一致 —— 那边走
 * `jsonInit(method, payload)` → `JSON.stringify(payload)`。`MAX_BODY_BYTES` 是后端对
 * **整个请求体**的限制，所以这里连 JSON 外壳和字段名一起算。算的和发的不是同一个形状，
 * 就又是「界面放行、后端拒绝」。
 *
 * 传 `undefined` 表示不带 body（备注留空时 `createKey` 就是这么发的），算 0 字节。
 *
 * **同一个备注，新建和编辑算出来的字节数不一样**：PATCH 的 body 是 `{ id, note }`，
 * 比 POST 的 `{ note }` 多一个 36 字符的 uuid，所以**编辑路径的有效上限比新建小 44 字节**
 * （实测：同一段备注新建 8205、编辑 8249）。这不是算错 —— 上限卡的是**整个请求体**，
 * 两条路径各按自己真正要发的形状算才对。看到同一段备注在两处显示不同字节数时别当成 bug。
 */
const jsonBodyBytes = (payload: unknown): number =>
  payload === undefined ? 0 : new TextEncoder().encode(JSON.stringify(payload)).length;

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
  const atLimit = keys.length >= MAX_KEYS;
  // 备注按字素簇算，不是 String.length —— 一个 emoji 算 1 个
  const trimmedNote = noteDraft.trim();
  const noteLen = noteLength(trimmedNote);
  const noteTooLong = noteLen > MAX_NOTE_LENGTH;
  // 字素簇没超不代表发得出去：组合记号能把体积顶上去（见 jsonBodyBytes 的注释）。
  // 形状与 mcpApi.createKey 真正发的 body 一致 —— 备注留空时它不带 body
  const noteBodyBytes = jsonBodyBytes(trimmedNote ? { note: trimmedNote } : undefined);
  const noteTooBig = noteBodyBytes > MAX_BODY_BYTES;
  const noteBlocked = noteTooLong || noteTooBig;

  async function createKey() {
    if (busy || atLimit || noteBlocked) return;
    setBusy(true);
    try {
      const result = await mcpApi.createKey(trimmedNote || undefined);
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
    // 清空备注要显式传 null —— 后端把「缺 note 字段」当成 400，不当成清空
    const note = editDraft.trim();
    const payloadNote = note === "" ? null : note;
    // 两种超限都不该走到这里（按钮已禁用），留一道兜底：后端会 400，
    // 与其让用户看报错，不如在这一层就说清楚
    if (noteLength(note) > MAX_NOTE_LENGTH) {
      toast.error(`备注最多 ${MAX_NOTE_LENGTH} 个字符${NOTE_UNIT_HINT}`);
      return;
    }
    // 形状与 mcpApi.updateKeyNote 真正发的 body 一致
    const bodyBytes = jsonBodyBytes({ id, note: payloadNote });
    if (bodyBytes > MAX_BODY_BYTES) {
      toast.error(`备注编码后 ${bodyBytes} 字节，超过请求体上限 ${MAX_BODY_BYTES} 字节`);
      return;
    }
    setBusy(true);
    try {
      await mcpApi.updateKeyNote(id, payloadNote);
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
                    aria-invalid={noteBlocked}
                    disabled={busy || atLimit}
                  />
                  <Button
                    className="shrink-0"
                    onClick={() => void createKey()}
                    disabled={busy || atLimit || noteBlocked}
                  >
                    <KeyRound />
                    生成密钥
                  </Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>备注最多 {MAX_NOTE_LENGTH} 个字符，留空则显示「未命名」</span>
                  <span className="flex items-center gap-x-3">
                    <span className={noteBlocked ? "font-medium text-destructive" : undefined}>
                      备注 {noteLen} / {MAX_NOTE_LENGTH}
                    </span>
                    <span>
                      {keys.length} / {MAX_KEYS} 把
                    </span>
                  </span>
                </div>
                {noteTooLong ? (
                  <p
                    aria-live="polite"
                    className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    备注 {noteLen} 个字符，超过 {MAX_NOTE_LENGTH} 了{NOTE_UNIT_HINT}。删掉一些再生成。
                  </p>
                ) : null}
                {noteTooBig ? (
                  <p
                    aria-live="polite"
                    className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
                  >
                    字符数是 {noteLen}，没超 {MAX_NOTE_LENGTH}；但编码后是 {noteBodyBytes} 字节，超过
                    请求体上限 {MAX_BODY_BYTES} 字节了 —— 超的是
                    <span className="font-medium">体积</span>，不是字数：组合记号（如声调符）和
                    emoji 一个字符就占好几个字节。再删一些。
                  </p>
                ) : null}
                {atLimit ? (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    已经到 {MAX_KEYS} 把上限了。先吊销不用的，再建新的。
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
  // 就地编辑这条走的是同一个 updateKeyNote 路径，两种上限都要和新建那条一样查
  const trimmedDraft = draft.trim();
  const draftLen = noteLength(trimmedDraft);
  const draftTooLong = draftLen > MAX_NOTE_LENGTH;
  // 形状与 mcpApi.updateKeyNote 真正发的 body 一致（清空时 note 是 null，不是缺字段）
  const draftBodyBytes = jsonBodyBytes({
    id: info.id,
    note: trimmedDraft === "" ? null : trimmedDraft,
  });
  const draftTooBig = draftBodyBytes > MAX_BODY_BYTES;
  const draftBlocked = draftTooLong || draftTooBig;

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          {editing ? (
            <div className="space-y-1">
              <Input
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !draftBlocked) onSave();
                  if (e.key === "Escape") onCancelEdit();
                }}
                aria-label="备注"
                aria-invalid={draftBlocked}
                placeholder="备注（可留空）"
                disabled={busy}
              />
              <div
                className={`text-xs ${
                  draftBlocked ? "font-medium text-destructive" : "text-muted-foreground"
                }`}
              >
                备注 {draftLen} / {MAX_NOTE_LENGTH}
                {draftTooLong ? ` · 超过 ${MAX_NOTE_LENGTH} 了${NOTE_UNIT_HINT}` : ""}
                {draftTooBig
                  ? ` · 字符数没超，但编码后 ${draftBodyBytes} 字节，超过请求体上限 ${MAX_BODY_BYTES} 字节`
                  : ""}
              </div>
            </div>
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
              <Button size="sm" disabled={busy || draftBlocked} onClick={onSave}>
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
