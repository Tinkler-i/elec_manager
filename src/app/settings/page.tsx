"use client";

import { useState } from "react";
import {
  ArrowUpCircle,
  Database,
  Download,
  ExternalLink,
  Info,
  KeyRound,
  RotateCw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadError } from "@/components/layout/load-error";
import { PageHeader } from "@/components/layout/page-header";
import { SkeletonBar } from "@/components/layout/skeleton-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  authApi,
  backupApi,
  errText,
  readingsApi,
  settingsApi,
  updateApi,
} from "@/lib/api";
import { fmtDateTime, fmtSize } from "@/lib/format";
import { useAsyncAll } from "@/lib/use-async-data";
import type { UpdateInfo } from "@/types";

/**
 * 设置。
 *
 * 拆成四个 Tab 而不是四张竖排卡片：备份列表会长到十几条，竖排时"修改密码"
 * 会被挤到屏幕外，而这两件事在用户心里是两件事，不该互相挤。
 */
export default function SettingsPage() {
  const { values, errors, isInitialLoading, isInitialFailed, reload } = useAsyncAll({
    settings: settingsApi.get,
    backups: backupApi.list,
  });

  // 用户改过的草稿；null = 还没动过，表单直接跟着服务端值走。
  // 用「草稿 ?? 服务端值」而不是 useEffect 里 setState：后者会多一轮渲染，
  // 而且后台刷新时容易把用户正在输入的内容覆盖掉。
  const [draft, setDraft] = useState<{ rate: string; initial: string } | null>(null);
  const form =
    draft ??
    (values.settings
      ? {
          rate: values.settings.rate_per_kwh ?? "0.56",
          initial: values.settings.initial_reading ?? "0",
        }
      : null);

  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState({ next: "", confirm: "" });
  const [changingPassword, setChangingPassword] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ name: string | null } | null>(null);

  /**
   * 更新检查单独用一个 useAsyncAll，不并进上面那个。
   *
   * 上面那份任意一项失败会让整页进错误态，而「GitHub 连不上」不该把设置页一起
   * 废掉 —— 它跑它的，页面照常渲染。
   */
  const update = useAsyncAll({ info: () => updateApi.check() });
  // 手动点「检查更新」时强制绕过服务端缓存，结果覆盖自动检查那份
  const [forced, setForced] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const info = forced ?? update.values.info;

  async function checkNow() {
    if (checking) return;
    setChecking(true);
    try {
      setForced(await updateApi.check(true));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setChecking(false);
    }
  }

  async function handleSave() {
    if (!form || saving) return;
    setSaving(true);
    try {
      await settingsApi.update({ rate_per_kwh: form.rate, initial_reading: form.initial });
      // 改了单价/初始读数，历史读数的 previous_reading 要跟着重算，
      // 否则用电量还是按旧基线算出来的
      await readingsApi.recalculate();
      await reload();
      // 保存成功 → 丢掉草稿，表单回到服务端值（重算后可能与提交值不同）
      setDraft(null);
      toast.success("设置已保存，读数已重新计算");
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!password.next) {
      toast.error("请输入新密码");
      return;
    }
    if (password.next !== password.confirm) {
      toast.error("两次输入的密码不一致");
      return;
    }
    setChangingPassword(true);
    try {
      await authApi.changePassword(password.next);
      setPassword({ next: "", confirm: "" });
      toast.success("密码已修改");
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const { fileName } = await backupApi.create();
      await reload();
      toast.success("备份创建成功");
      window.open(backupApi.downloadUrl(fileName), "_blank");
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBackupBusy(false);
    }
  }

  async function confirmDeleteBackup() {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.name === null) await backupApi.removeAll();
      else await backupApi.remove(pendingDelete.name);
      await reload();
      toast.success(pendingDelete.name === null ? "所有备份已删除" : "备份已删除");
      setPendingDelete(null);
    } catch (err) {
      toast.error(errText(err));
    }
  }

  if (isInitialFailed) {
    return (
      <>
        <PageHeader title="设置" />
        <LoadError className="py-24" error={errors.settings ?? errors.backups} onRetry={reload} />
      </>
    );
  }

  const backups = values.backups ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="设置" description="电表参数、数据导出、登录密码与备份" />

      <Tabs defaultValue="meter">
        <TabsList>
          <TabsTrigger value="meter">
            <Settings2 className="size-4" />
            电表配置
          </TabsTrigger>
          <TabsTrigger value="data">
            <Download className="size-4" />
            数据导出
          </TabsTrigger>
          <TabsTrigger value="auth">
            <KeyRound className="size-4" />
            登录密码
          </TabsTrigger>
          <TabsTrigger value="backup">
            <Database className="size-4" />
            数据备份
          </TabsTrigger>
          <TabsTrigger value="about">
            <Info className="size-4" />
            关于
            {info?.hasUpdate ? (
              <span aria-hidden className="size-2 rounded-full bg-blue-500" />
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="meter">
          <Card>
            <CardHeader>
              <CardTitle>电表配置</CardTitle>
              <CardDescription>修改后会自动重算全部历史读数的用电量</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isInitialLoading || !form ? (
                <>
                  <SkeletonBar className="h-16 w-full" />
                  <SkeletonBar className="h-16 w-full" />
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="initial_reading">初始读数（电表安装时的读数）</Label>
                    <Input
                      id="initial_reading"
                      type="number"
                      step="0.01"
                      value={form.initial}
                      onChange={(e) => setDraft({ ...form, initial: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      第一条读数的用电量基于此值计算，不是 0 的话务必填对。
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rate">每度电价（元）</Label>
                    <Input
                      id="rate"
                      type="number"
                      step="0.0001"
                      value={form.rate}
                      onChange={(e) => setDraft({ ...form, rate: e.target.value })}
                    />
                  </div>
                  <Button onClick={handleSave} disabled={saving}>
                    <Save />
                    {saving ? "保存中..." : "保存设置"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data">
          <Card>
            <CardHeader>
              <CardTitle>数据导出</CardTitle>
              <CardDescription>导出为 CSV，可用 Excel 直接打开</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => window.open("/api/export?type=readings", "_blank")}>
                <Download />
                导出读数数据
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="auth">
          <Card>
            <CardHeader>
              <CardTitle>登录密码</CardTitle>
              <CardDescription>修改后当前会话仍然有效，下次登录用新密码</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new_password">新密码</Label>
                  <Input
                    id="new_password"
                    type="password"
                    autoComplete="new-password"
                    value={password.next}
                    onChange={(e) => setPassword({ ...password, next: e.target.value })}
                    placeholder="输入新密码"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm_password">确认密码</Label>
                  <Input
                    id="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    value={password.confirm}
                    onChange={(e) => setPassword({ ...password, confirm: e.target.value })}
                    placeholder="再次输入新密码"
                  />
                </div>
              </div>
              <Button onClick={handleChangePassword} disabled={changingPassword}>
                <KeyRound />
                {changingPassword ? "修改中..." : "修改密码"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="backup">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle>数据备份</CardTitle>
                  <CardDescription>备份是数据库文件的完整副本，保存在服务器 data/backups 下</CardDescription>
                </div>
                <Button onClick={handleBackup} disabled={backupBusy}>
                  <Database />
                  {backupBusy ? "创建中..." : "创建并下载备份"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isInitialLoading ? (
                <SkeletonBar className="h-24 w-full" />
              ) : backups.length === 0 ? (
                <EmptyState icon={Database} title="还没有备份" description="点右上角创建第一份。" className="py-8" />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">共 {backups.length} 份</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setPendingDelete({ name: null })}
                    >
                      <Trash2 />
                      删除全部
                    </Button>
                  </div>
                  {backups.map((backup) => (
                    <div
                      key={backup.name}
                      className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{backup.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtSize(backup.size)} · {fmtDateTime(backup.created)}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="下载备份"
                          onClick={() => window.open(backupApi.downloadUrl(backup.name), "_blank")}
                        >
                          <Download />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="删除备份"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPendingDelete({ name: backup.name })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="about">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>关于</CardTitle>
                  <CardDescription>版本信息与更新检查</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkNow}
                  disabled={checking || update.isInitialLoading}
                >
                  <RotateCw className={checking ? "animate-spin" : undefined} />
                  {checking ? "检查中..." : "检查更新"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground">当前版本</span>
                <span className="text-lg font-semibold tabular-nums">
                  {info?.current ?? (update.isInitialLoading ? "读取中..." : "未知")}
                </span>
              </div>

              {update.isInitialLoading ? (
                <SkeletonBar className="h-20 w-full" />
              ) : (
                <UpdateStatus info={info} error={update.errors.info} onRetry={checkNow} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={pendingDelete?.name === null ? "删除全部备份" : "删除备份"}
        description={
          pendingDelete?.name === null
            ? `确定要删除全部 ${backups.length} 份备份吗？此操作不可撤销。`
            : `确定要删除备份 ${pendingDelete?.name ?? ""} 吗？此操作不可撤销。`
        }
        confirmLabel="删除"
        destructive
        onConfirm={confirmDeleteBackup}
      />
    </div>
  );
}

/**
 * 更新状态区。
 *
 * 三种情况必须分开显示：「查到有新版本」「确认已是最新」「这次没查成」。
 * 第三种绝不能渲染成「已是最新」—— 那是撒谎，用户会以为自己没漏掉更新。
 *
 * 必须是模块级组件：写在页面组件里等于每次渲染新建一个组件类型，React 会当成
 * 另一个组件卸载重建，React 19 的 lint 规则也会直接报错。
 */
function UpdateStatus({
  info,
  error,
  onRetry,
}: {
  info?: UpdateInfo;
  error?: unknown;
  onRetry: () => void;
}) {
  const reason = error ? errText(error) : info?.error;
  if (reason) {
    return (
      <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
        <div className="font-medium">没能检查更新</div>
        <div>{reason}</div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw />
          重试
        </Button>
      </div>
    );
  }

  if (!info) {
    return <div className="text-xs text-muted-foreground">暂无版本信息</div>;
  }

  if (info.hasUpdate && info.latest) {
    return (
      <div className="space-y-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
          <ArrowUpCircle className="size-4" />
          有新版本 {info.latest}
        </div>
        <p className="text-xs text-blue-700/80 dark:text-blue-300/80">
          {info.publishedAt ? `发布于 ${fmtDateTime(info.publishedAt)}。` : ""}
          去 Releases 页面下载对应架构的 fpk，再到飞牛应用中心左下角「手动安装」即可升级，数据会保留。
        </p>
        {info.notes ? (
          <pre className="hide-scrollbar max-h-40 overflow-auto rounded-md bg-background/60 p-2 font-sans text-xs whitespace-pre-wrap text-foreground/80">
            {info.notes}
          </pre>
        ) : null}
        <Button size="sm" onClick={() => window.open(info.releaseUrl, "_blank")}>
          <ExternalLink />
          前往下载
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
      已是最新版本
      {info.latest ? `（最新 ${info.latest}）` : ""} · 检查于 {fmtDateTime(info.checkedAt)}
      {info.cached ? "，缓存结果" : ""}
    </div>
  );
}
