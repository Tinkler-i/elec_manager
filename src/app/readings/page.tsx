"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Reading } from "@/types";
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Check } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

export default function ReadingsPage() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReading, setEditingReading] = useState<Reading | null>(null);
  const [rate, setRate] = useState(0.56);
  const [initialReading, setInitialReading] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [jumpTo, setJumpTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    reading_value: "",
    reading_date: new Date().toISOString().split("T")[0],
    reading_time: "",
    notes: "",
  });

  useEffect(() => {
    fetchReadings();
    fetchSettings();
  }, []);

  async function fetchReadings() {
    try {
      const response = await fetch("/api/readings");
      const data = await response.json();
      setReadings(data);
    } catch (error) {
      console.error("获取读数失败:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSettings() {
    try {
      const response = await fetch("/api/settings");
      if (!response.ok) {
        console.error("获取设置失败:", response.status);
        return;
      }
      const data = await response.json();
      if (data.rate_per_kwh) {
        setRate(parseFloat(data.rate_per_kwh));
      }
      if (data.initial_reading !== undefined) {
        setInitialReading(parseFloat(data.initial_reading));
      }
    } catch (error) {
      console.error("获取设置失败:", error);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const url = editingReading
        ? `/api/readings/${editingReading.id}`
        : "/api/readings";
      const method = editingReading ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reading_value: parseFloat(formData.reading_value),
          reading_date: formData.reading_date,
          reading_time: formData.reading_time || null,
          notes: formData.notes || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error);
      }

      toast.success(editingReading ? "读数已更新" : "读数已添加");
      setDialogOpen(false);
      setEditingReading(null);
      setFormData({
        reading_value: "",
        reading_date: new Date().toISOString().split("T")[0],
        reading_time: "",
        notes: "",
      });
      fetchReadings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定要删除这条读数记录吗？")) return;

    try {
      const response = await fetch(`/api/readings/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("删除失败");

      toast.success("读数已删除");
      fetchReadings();
    } catch (error) {
      toast.error("删除失败");
    }
  }

  async function handleBatchDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 条记录吗？`)) return;

    try {
      const response = await fetch("/api/readings/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });

      if (!response.ok) throw new Error("批量删除失败");

      const result = await response.json();
      toast.success(`已删除 ${result.deleted} 条记录`);
      setSelectedIds(new Set());
      setPage(0);
      fetchReadings();
    } catch (error) {
      toast.error("批量删除失败");
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const pagedIds = pagedReadings.map(r => r.id);
    const allSelected = pagedIds.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pagedIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pagedIds.forEach(id => next.add(id));
        return next;
      });
    }
  }

  function handleEdit(reading: Reading) {
    setEditingReading(reading);
    setFormData({
      reading_value: String(reading.reading_value),
      reading_date: reading.reading_date,
      reading_time: reading.reading_time || "",
      notes: reading.notes || "",
    });
    setDialogOpen(true);
  }

  const prevReadingForPreview = useMemo(() => {
    if (!dialogOpen) return undefined;
    return readings
      .filter(r => r.reading_date < formData.reading_date)
      .sort((a, b) => b.reading_date.localeCompare(a.reading_date))[0];
  }, [readings, formData.reading_date, dialogOpen]);

  const baseValue = prevReadingForPreview ? prevReadingForPreview.reading_value : initialReading;
  const previewUnits = formData.reading_value
    ? Math.max(0, parseFloat(formData.reading_value) - baseValue)
    : 0;
  const previewCost = previewUnits * rate;

  const totalPages = Math.ceil(readings.length / pageSize);
  const pagedReadings = readings.slice(page * pageSize, (page + 1) * pageSize);

  function handleJumpToPage() {
    const num = parseInt(jumpTo, 10);
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      setPage(num - 1);
      setJumpTo("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">读数记录</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="w-4 h-4 mr-2" />
            添加读数
          </DialogTrigger>
          <DialogContent showOverlay={!editingReading}>
            <DialogHeader>
              <DialogTitle>{editingReading ? "编辑读数" : "添加读数"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="reading_value">表读数</Label>
                <Input
                  id="reading_value"
                  type="number"
                  step="0.01"
                  value={formData.reading_value}
                  onChange={(e) => setFormData({ ...formData, reading_value: e.target.value })}
                  required
                />
              </div>
              {formData.reading_value && (
                <div className="p-3 bg-gray-50 rounded-lg text-sm">
                  <div>上次读数：{prevReadingForPreview ? prevReadingForPreview.reading_value : initialReading}</div>
                  <div>上次日期：{prevReadingForPreview ? prevReadingForPreview.reading_date : '初始读数'}</div>
                  <div>本次用电：{previewUnits.toFixed(2)} 度</div>
                  <div>预计费用：¥{previewCost.toFixed(2)}</div>
                </div>
              )}
              <div>
                <Label htmlFor="reading_date">读数日期</Label>
                <Input
                  id="reading_date"
                  type="date"
                  value={formData.reading_date}
                  onChange={(e) => setFormData({ ...formData, reading_date: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="reading_time">记录时间（可选）</Label>
                <Input
                  id="reading_time"
                  type="time"
                  value={formData.reading_time}
                  onChange={(e) => setFormData({ ...formData, reading_time: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="notes">备注</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
              <Button type="submit" className="w-full">
                {editingReading ? "更新" : "添加"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>历史读数</CardTitle>
            {selectedIds.size > 0 && (
              <Button variant="destructive" size="sm" onClick={handleBatchDelete}>
                <Trash2 className="w-4 h-4 mr-1" />
                删除选中 ({selectedIds.size})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">加载中...</div>
          ) : readings.length === 0 ? (
            <div className="text-center py-4 text-gray-500">暂无读数记录</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <button onClick={toggleSelectAll} className="flex items-center justify-center w-4 h-4 border rounded">
                        {pagedReadings.length > 0 && pagedReadings.every(r => selectedIds.has(r.id)) && <Check className="w-3 h-3" />}
                      </button>
                    </TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead>表读数</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedReadings.map((reading) => (
                    <TableRow key={reading.id}>
                      <TableCell>
                        <button
                          onClick={() => toggleSelect(reading.id)}
                          className="flex items-center justify-center w-4 h-4 border rounded"
                        >
                          {selectedIds.has(reading.id) && <Check className="w-3 h-3" />}
                        </button>
                      </TableCell>
                      <TableCell>{reading.reading_date}</TableCell>
                      <TableCell>{reading.reading_time || "-"}</TableCell>
                      <TableCell>
                        {reading.source === 'mcp' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">AI</span>
                        ) : reading.source === 'import' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">导入</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">手工</span>
                        )}
                      </TableCell>
                      <TableCell>{reading.reading_value}</TableCell>
                      <TableCell>{reading.notes || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(reading)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(reading.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); setSelectedIds(new Set()); }}
                    className="border rounded px-2 py-1 text-sm"
                  >
                    {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} 条/页</option>)}
                  </select>
                  <span className="text-sm text-gray-500">
                    共 {readings.length} 条
                  </span>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(0)}>
                      <ChevronsLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm px-2">
                      {page + 1} / {totalPages}
                    </span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
                      <ChevronsRight className="w-4 h-4" />
                    </Button>
                    <span className="text-sm text-gray-500">跳至</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={jumpTo}
                      onChange={(e) => setJumpTo(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleJumpToPage()}
                      onBlur={handleJumpToPage}
                      className="w-14 border rounded px-2 py-1 text-sm text-center"
                    />
                    <span className="text-sm text-gray-500">页</span>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
