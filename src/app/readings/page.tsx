"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Gauge,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadError } from "@/components/layout/load-error";
import { PageHeader } from "@/components/layout/page-header";
import { SkeletonRows } from "@/components/layout/skeleton-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { errText, readingsApi, settingsApi } from "@/lib/api";
import { fmtMoney, fmtNumber, today } from "@/lib/format";
import { useAsyncAll } from "@/lib/use-async-data";
import type { Reading } from "@/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
const EMPTY_READINGS: Reading[] = [];

const SOURCE_META: Record<Reading["source"], { label: string; className: string }> = {
  manual: { label: "手工", className: "bg-muted text-muted-foreground" },
  mcp: { label: "AI", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  import: { label: "导入", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

interface FormState {
  reading_value: string;
  reading_date: string;
  reading_time: string;
  notes: string;
}

const emptyForm = (): FormState => ({
  reading_value: "",
  reading_date: today(),
  reading_time: "",
  notes: "",
});

/**
 * 读数记录。
 *
 * 取数交给 useAsyncAll（首屏骨架 / 错误重试 / 后台刷新三态分明），写操作之后
 * 用 `reload()` 的返回值区分「写失败」与「写成功但列表没刷上」—— 后者若报成
 * 失败，用户会再点一次，于是多出一条重复读数。
 */
export default function ReadingsPage() {
  const { values, errors, isInitialLoading, isInitialFailed, reload } = useAsyncAll({
    readings: readingsApi.list,
    settings: settingsApi.get,
  });

  const readings = values.readings ?? EMPTY_READINGS;
  const rate = Number(values.settings?.rate_per_kwh ?? 0.56);
  const initialReading = Number(values.settings?.initial_reading ?? 0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Reading | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [jumpTo, setJumpTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [pendingDelete, setPendingDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const prevReadingForPreview = useMemo(() => {
    if (!dialogOpen) return undefined;
    return readings
      .filter((r) => r.reading_date < form.reading_date)
      .sort((a, b) => b.reading_date.localeCompare(a.reading_date))[0];
  }, [readings, form.reading_date, dialogOpen]);

  const baseValue = prevReadingForPreview ? prevReadingForPreview.reading_value : initialReading;
  const previewUnits = form.reading_value ? Math.max(0, parseFloat(form.reading_value) - baseValue) : 0;

  const totalPages = Math.max(1, Math.ceil(readings.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedReadings = readings.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const allPagedSelected =
    pagedReadings.length > 0 && pagedReadings.every((r) => selectedIds.has(r.id));

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(reading: Reading) {
    setEditing(reading);
    setForm({
      reading_value: String(reading.reading_value),
      reading_date: reading.reading_date,
      reading_time: reading.reading_time ?? "",
      notes: reading.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        reading_value: parseFloat(form.reading_value),
        reading_date: form.reading_date,
        reading_time: form.reading_time || null,
        notes: form.notes || null,
      };
      if (editing) await readingsApi.update(editing.id, payload);
      else await readingsApi.create(payload);

      // 写成功了。列表刷新失败要单独说，不能吞掉也不能报成"写入失败"
      const refreshed = await reload();
      toast.success(
        refreshed
          ? editing
            ? "读数已更新"
            : "读数已添加"
          : "已保存，但列表刷新失败，请手动刷新页面",
      );
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm());
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      if (pendingDelete.ids.length === 1) {
        await readingsApi.remove(pendingDelete.ids[0]);
      } else {
        await readingsApi.removeMany(pendingDelete.ids);
      }
      setSelectedIds(new Set());
      const refreshed = await reload();
      toast.success(refreshed ? "已删除" : "已删除，但列表刷新失败，请手动刷新页面");
      setPendingDelete(null);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pagedReadings.forEach((r) => (allPagedSelected ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  }

  function handleJumpToPage() {
    const num = parseInt(jumpTo, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= totalPages) {
      setPage(num - 1);
      setJumpTo("");
    }
  }

  if (isInitialFailed) {
    return (
      <>
        <PageHeader title="读数记录" />
        <LoadError className="py-24" error={errors.readings} onRetry={reload} />
      </>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="读数记录"
        description={readings.length > 0 ? `共 ${fmtNumber(readings.length, 0)} 条` : "记录每次抄表的表读数"}
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button />} onClick={openCreate}>
              <Plus />
              添加读数
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editing ? "编辑读数" : "添加读数"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reading_value">表读数</Label>
                  <Input
                    id="reading_value"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={form.reading_value}
                    onChange={(e) => setForm({ ...form, reading_value: e.target.value })}
                    required
                    autoFocus
                  />
                </div>

                {form.reading_value ? (
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">上次读数</div>
                      <div className="font-medium tabular-nums">{fmtNumber(baseValue, 2)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">上次日期</div>
                      <div className="font-medium">
                        {prevReadingForPreview ? prevReadingForPreview.reading_date : "初始读数"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">本次用电</div>
                      <div className="font-medium tabular-nums">{fmtNumber(previewUnits, 2)} 度</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">预计费用</div>
                      <div className="font-medium tabular-nums">{fmtMoney(previewUnits * rate)}</div>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="reading_date">读数日期</Label>
                    <Input
                      id="reading_date"
                      type="date"
                      value={form.reading_date}
                      onChange={(e) => setForm({ ...form, reading_date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reading_time">记录时间（可选）</Label>
                    <Input
                      id="reading_time"
                      type="time"
                      value={form.reading_time}
                      onChange={(e) => setForm({ ...form, reading_time: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="notes">备注</Label>
                  <Textarea
                    id="notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    maxLength={500}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "保存中..." : editing ? "更新" : "添加"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>历史读数</CardTitle>
            {selectedIds.size > 0 ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  setPendingDelete({
                    ids: Array.from(selectedIds),
                    label: `选中的 ${selectedIds.size} 条记录`,
                  })
                }
              >
                <Trash2 />
                删除选中 ({selectedIds.size})
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {isInitialLoading ? (
            <SkeletonRows rows={6} />
          ) : readings.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title="还没有读数记录"
              description="添加第一条读数后，仪表盘与数据分析就有数据了。"
              action={
                <Button size="sm" onClick={openCreate}>
                  <Plus />
                  添加读数
                </Button>
              }
            />
          ) : (
            <>
              <div className="hide-scrollbar -mx-4 overflow-x-auto px-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <button
                          type="button"
                          onClick={toggleSelectAll}
                          aria-label="全选本页"
                          className={cn(
                            "grid size-4 place-items-center rounded border transition-colors",
                            allPagedSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input hover:border-foreground/40",
                          )}
                        >
                          {allPagedSelected ? <Check className="size-3" /> : null}
                        </button>
                      </TableHead>
                      <TableHead>日期</TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead className="text-right">表读数</TableHead>
                      <TableHead className="text-right">用电</TableHead>
                      <TableHead>备注</TableHead>
                      <TableHead className="w-20 text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedReadings.map((reading) => {
                      const meta = SOURCE_META[reading.source] ?? SOURCE_META.manual;
                      return (
                        <TableRow key={reading.id}>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => toggleSelect(reading.id)}
                              aria-label={`选择 ${reading.reading_date} 的读数`}
                              className={cn(
                                "grid size-4 place-items-center rounded border transition-colors",
                                selectedIds.has(reading.id)
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input hover:border-foreground/40",
                              )}
                            >
                              {selectedIds.has(reading.id) ? <Check className="size-3" /> : null}
                            </button>
                          </TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{reading.reading_date}</TableCell>
                          <TableCell className="text-muted-foreground">{reading.reading_time || "-"}</TableCell>
                          <TableCell>
                            <Badge className={cn("border-transparent", meta.className)}>{meta.label}</Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNumber(reading.reading_value, 2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtNumber(reading.units_consumed, 2)}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-muted-foreground" title={reading.notes ?? ""}>
                            {reading.notes || "-"}
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button variant="ghost" size="icon-sm" onClick={() => openEdit(reading)} aria-label="编辑">
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive"
                              aria-label="删除"
                              onClick={() =>
                                setPendingDelete({
                                  ids: [reading.id],
                                  label: `${reading.reading_date} 的读数`,
                                })
                              }
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      setPage(0);
                      setSelectedIds(new Set());
                    }}
                  >
                    <SelectTrigger size="sm" className="w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} 条/页
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">共 {readings.length} 条</span>
                </div>

                {totalPages > 1 ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      disabled={safePage === 0}
                      onClick={() => setPage(0)}
                      aria-label="第一页"
                    >
                      <ChevronsLeft />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      disabled={safePage === 0}
                      onClick={() => setPage(safePage - 1)}
                      aria-label="上一页"
                    >
                      <ChevronLeft />
                    </Button>
                    <span className="px-1 text-xs tabular-nums">
                      {safePage + 1} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      disabled={safePage >= totalPages - 1}
                      onClick={() => setPage(safePage + 1)}
                      aria-label="下一页"
                    >
                      <ChevronRight />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      disabled={safePage >= totalPages - 1}
                      onClick={() => setPage(totalPages - 1)}
                      aria-label="最后一页"
                    >
                      <ChevronsRight />
                    </Button>
                    <span className="ml-1 text-xs text-muted-foreground">跳至</span>
                    <Input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={jumpTo}
                      onChange={(e) => setJumpTo(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleJumpToPage()}
                      onBlur={handleJumpToPage}
                      className="h-7 w-14 text-center text-xs"
                      aria-label="跳转页码"
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除读数"
        description={`确定要删除${pendingDelete?.label ?? ""}吗？删除后前后两条读数的用电量会被重新计算，此操作不可撤销。`}
        confirmLabel="删除"
        destructive
        busy={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
