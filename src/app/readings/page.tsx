"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Reading } from "@/types";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function ReadingsPage() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReading, setEditingReading] = useState<Reading | null>(null);
  const [rate, setRate] = useState(0.56);
  const [initialReading, setInitialReading] = useState(0);
  const [formData, setFormData] = useState({
    reading_value: "",
    reading_date: new Date().toISOString().split("T")[0],
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

  function handleEdit(reading: Reading) {
    setEditingReading(reading);
    setFormData({
      reading_value: String(reading.reading_value),
      reading_date: reading.reading_date,
      notes: reading.notes || "",
    });
    setDialogOpen(true);
  }

  const prevReadingForPreview = readings
    .filter(r => r.reading_date < formData.reading_date)
    .sort((a, b) => b.reading_date.localeCompare(a.reading_date))[0];

  const baseValue = prevReadingForPreview ? prevReadingForPreview.reading_value : initialReading;
  const previewUnits = formData.reading_value
    ? Math.max(0, parseFloat(formData.reading_value) - baseValue)
    : 0;
  const previewCost = previewUnits * rate;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">读数记录</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="w-4 h-4 mr-2" />
            添加读数
          </DialogTrigger>
          <DialogContent>
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
          <CardTitle>历史读数</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">加载中...</div>
          ) : readings.length === 0 ? (
            <div className="text-center py-4 text-gray-500">暂无读数记录</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>表读数</TableHead>
                  <TableHead>用电量</TableHead>
                  <TableHead>费用</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readings.map((reading) => (
                  <TableRow key={reading.id}>
                    <TableCell>{reading.reading_date}</TableCell>
                    <TableCell>{reading.reading_value}</TableCell>
                    <TableCell>{reading.units_consumed?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell>
                      {reading.units_consumed ? `¥${(reading.units_consumed * rate).toFixed(2)}` : "-"}
                    </TableCell>
                    <TableCell>{reading.notes || "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(reading)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(reading.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
