"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Database } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  const [rate, setRate] = useState("0.56");
  const [initialReading, setInitialReading] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backups, setBackups] = useState<{ name: string; size: number; created: string }[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchBackups();
  }, []);

  async function fetchSettings() {
    try {
      const response = await fetch("/api/settings");
      if (!response.ok) {
        console.error("获取设置失败:", response.status);
        return;
      }
      const data = await response.json();
      if (data.rate_per_kwh) {
        setRate(data.rate_per_kwh);
      }
      if (data.initial_reading) {
        setInitialReading(data.initial_reading);
      }
    } catch (error) {
      console.error("获取设置失败:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchBackups() {
    try {
      const response = await fetch("/api/backup");
      const data = await response.json();
      setBackups(data);
    } catch (error) {
      console.error("获取备份列表失败:", error);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rate_per_kwh: rate,
          initial_reading: initialReading,
        }),
      });

      if (!response.ok) throw new Error("保存失败");

      await fetch("/api/readings/recalculate", { method: "POST" });

      toast.success("设置已保存，读数已重新计算");
    } catch (error) {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleBackup() {
    try {
      const response = await fetch("/api/backup", { method: "POST" });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      toast.success("备份创建成功");

      window.open(`/api/backup?file=${encodeURIComponent(data.fileName)}`, "_blank");

      fetchBackups();
    } catch (error) {
      toast.error("备份失败");
    }
  }

  function handleDownloadBackup(fileName: string) {
    window.open(`/api/backup?file=${encodeURIComponent(fileName)}`, "_blank");
  }

  function handleExport(type: string) {
    window.open(`/api/export?type=${type}`, "_blank");
  }

  async function handleChangePassword() {
    if (!newPassword) {
      toast.error("请输入新密码");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }

    setChangingPassword(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });

      if (!response.ok) throw new Error("修改失败");

      toast.success("密码已修改");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast.error("修改密码失败");
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">设置</h1>

      <Card>
        <CardHeader>
          <CardTitle>电表配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="initial_reading">初始读数（电表安装时的读数）</Label>
            <Input
              id="initial_reading"
              type="number"
              step="0.01"
              value={initialReading}
              onChange={(e) => setInitialReading(e.target.value)}
            />
            <p className="text-sm text-gray-500 mt-1">
              第一条读数的用电量将基于此初始读数计算
            </p>
          </div>
          <div>
            <Label htmlFor="rate">每度电价（元）</Label>
            <Input
              id="rate"
              type="number"
              step="0.0001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存设置"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>数据导出</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Button variant="outline" onClick={() => handleExport("readings")}>
              <Download className="w-4 h-4 mr-2" />
              导出读数数据
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>登录密码</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="new_password">新密码</Label>
            <Input
              id="new_password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="输入新密码"
            />
          </div>
          <div>
            <Label htmlFor="confirm_password">确认密码</Label>
            <Input
              id="confirm_password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
            />
          </div>
          <Button onClick={handleChangePassword} disabled={changingPassword}>
            {changingPassword ? "修改中..." : "修改密码"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>数据备份</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleBackup}>
            <Database className="w-4 h-4 mr-2" />
            创建并下载备份
          </Button>

          {backups.length > 0 && (
            <div className="space-y-2">
              <Label>历史备份</Label>
              <div className="text-sm space-y-1">
                {backups.map((backup) => (
                  <div key={backup.name} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <div>
                      <div className="font-medium">{backup.name}</div>
                      <div className="text-gray-500 text-xs">
                        {(backup.size / 1024).toFixed(1)} KB · {new Date(backup.created).toLocaleString("zh-CN")}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadBackup(backup.name)}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
