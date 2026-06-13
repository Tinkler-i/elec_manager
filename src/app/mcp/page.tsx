"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Play, Settings, Code, History, BookOpen, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  returns: Record<string, string>;
}

interface McpCallLog {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  status: "success" | "error";
}

const exampleRequests = [
  {
    title: "查询所有读数",
    tool: "获取读数",
    params: "{}",
  },
  {
    title: "查询指定日期范围的读数",
    tool: "获取读数",
    params: JSON.stringify({ start_date: "2026-01-01", end_date: "2026-06-30" }, null, 2),
  },
  {
    title: "添加一条读数",
    tool: "添加读数",
    params: JSON.stringify({ reading_value: 1250, reading_date: "2026-06-13", notes: "抄表" }, null, 2),
  },
  {
    title: "获取用电统计",
    tool: "用电统计",
    params: "{}",
  },
  {
    title: "创建数据库备份",
    tool: "备份数据库",
    params: "{}",
  },
];

export default function McpPage() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null);
  const [params, setParams] = useState("{}");
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState<string>("");
  const [callLogs, setCallLogs] = useState<McpCallLog[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    fetchTools();
    fetchToken();
  }, []);

  async function fetchTools() {
    try {
      const response = await fetch("/api/mcp");
      const data = await response.json();
      setTools(data.tools || []);
    } catch (error) {
      console.error("获取工具列表失败:", error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchToken() {
    try {
      const response = await fetch("/api/auth/token");
      if (!response.ok) {
        console.error("获取token失败:", response.status);
        return;
      }
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        console.error("响应不是JSON格式");
        return;
      }
      const data = await response.json();
      if (data.token) {
        setToken(data.token);
      }
    } catch (error) {
      console.error("获取token失败:", error);
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      setTokenCopied(true);
      toast.success("Token 已复制到剪贴板");
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  }

  async function handleCallTool() {
    if (!selectedTool) return;

    setCalling(true);
    setCallResult("");

    try {
      let parsedParams = {};
      if (params.trim()) {
        parsedParams = JSON.parse(params);
      }

      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: selectedTool.name,
          params: parsedParams,
        }),
      });

      const data = await response.json();

      const log: McpCallLog = {
        id: Date.now().toString(),
        tool: selectedTool.name,
        params: parsedParams,
        result: data,
        timestamp: new Date().toISOString(),
        status: response.ok ? "success" : "error",
      };

      setCallLogs((prev) => [log, ...prev].slice(0, 50));
      setCallResult(JSON.stringify(data, null, 2));

      if (response.ok) {
        toast.success(`${selectedTool.name} 调用成功`);
      } else {
        toast.error(data.error || "调用失败");
      }
    } catch (error) {
      const log: McpCallLog = {
        id: Date.now().toString(),
        tool: selectedTool.name,
        params: JSON.parse(params || "{}"),
        result: { error: "JSON解析失败或网络错误" },
        timestamp: new Date().toISOString(),
        status: "error",
      };
      setCallLogs((prev) => [log, ...prev].slice(0, 50));
      setCallResult(JSON.stringify({ error: "JSON解析失败或网络错误" }, null, 2));
      toast.error("调用失败");
    } finally {
      setCalling(false);
    }
  }

  function openToolDialog(tool: McpTool) {
    setSelectedTool(tool);
    const defaultParams: Record<string, unknown> = {};
    if (tool.inputSchema.properties) {
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        if (prop.type === "string") {
          defaultParams[key] = "";
        } else if (prop.type === "number") {
          defaultParams[key] = 0;
        }
      });
    }
    setParams(JSON.stringify(defaultParams, null, 2));
    setCallResult("");
    setDialogOpen(true);
  }

  function loadExample(example: typeof exampleRequests[0]) {
    const tool = tools.find(t => t.name === example.tool);
    if (tool) {
      setSelectedTool(tool);
      setParams(example.params);
      setCallResult("");
      setDialogOpen(true);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">MCP 工具</h1>
        <Badge variant="outline" className="text-sm">
          {tools.length} 个工具可用
        </Badge>
      </div>

      <Tabs defaultValue="usage">
        <TabsList>
          <TabsTrigger value="usage">
            <BookOpen className="w-4 h-4 mr-2" />
            使用说明
          </TabsTrigger>
          <TabsTrigger value="tools">
            <Settings className="w-4 h-4 mr-2" />
            工具列表
          </TabsTrigger>
          <TabsTrigger value="test">
            <Code className="w-4 h-4 mr-2" />
            在线测试
          </TabsTrigger>
          <TabsTrigger value="logs">
            <History className="w-4 h-4 mr-2" />
            调用日志
          </TabsTrigger>
        </TabsList>

        <TabsContent value="usage" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>MCP 认证 Token</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                AI 客户端连接时需要此 Token 进行认证。点击复制按钮获取 Token。
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-xs overflow-auto break-all">
                  {token || "获取中..."}
                </code>
                <Button variant="outline" size="sm" onClick={copyToken} disabled={!token}>
                  {tokenCopied ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>MCP 接口说明</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm space-y-2">
                <p><strong>接口地址：</strong><code className="bg-gray-100 px-2 py-1 rounded">POST /api/mcp</code></p>
                <p><strong>请求格式：</strong></p>
                <pre className="bg-gray-100 p-3 rounded-lg text-xs overflow-auto">{`{
  "tool": "工具名称",
  "params": { 参数对象 }
}`}</pre>
                <p><strong>响应格式（成功）：</strong></p>
                <pre className="bg-gray-100 p-3 rounded-lg text-xs overflow-auto">{`{
  "result": { 返回数据 }
}`}</pre>
                <p><strong>响应格式（失败）：</strong></p>
                <pre className="bg-gray-100 p-3 rounded-lg text-xs overflow-auto">{`{
  "error": "错误信息"
}`}</pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>可调用的工具</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="text-center py-4">加载中...</div>
              ) : (
                <div className="space-y-3">
                  {tools.map((tool) => (
                    <div key={tool.name} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <code className="font-medium text-blue-600">{tool.name}</code>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{tool.description}</p>
                      {Object.keys(tool.inputSchema.properties).length > 0 && (
                        <div className="text-xs text-gray-500">
                          参数：{Object.entries(tool.inputSchema.properties).map(([key, prop], i) => (
                            <span key={key}>
                              {i > 0 && "，"}
                              <code>{key}</code>({prop.description})
                              {tool.inputSchema.required?.includes(key) && <span className="text-red-500">*</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>调用示例</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {exampleRequests.map((example, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium">{example.title}</div>
                    <div className="text-xs text-gray-500">工具：{example.tool}</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => loadExample(example)}>
                    <Play className="w-4 h-4 mr-1" />
                    试一试
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tools" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>工具详情</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-4">加载中...</div>
              ) : tools.length === 0 ? (
                <div className="text-center py-4 text-gray-500">暂无可用工具</div>
              ) : (
                <div className="space-y-4">
                  {tools.map((tool) => (
                    <div key={tool.name} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-lg">{tool.name}</h3>
                        <Button variant="ghost" size="sm" onClick={() => openToolDialog(tool)}>
                          <Play className="w-4 h-4 mr-1" />
                          测试
                        </Button>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">{tool.description}</p>

                      {Object.keys(tool.inputSchema.properties).length > 0 && (
                        <div className="mb-3">
                          <Label className="text-xs text-gray-500">请求参数</Label>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>参数名</TableHead>
                                <TableHead>类型</TableHead>
                                <TableHead>说明</TableHead>
                                <TableHead>必填</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {Object.entries(tool.inputSchema.properties).map(([key, prop]) => (
                                <TableRow key={key}>
                                  <TableCell><code className="text-sm">{key}</code></TableCell>
                                  <TableCell>{prop.type}</TableCell>
                                  <TableCell>{prop.description}</TableCell>
                                  <TableCell>
                                    {tool.inputSchema.required?.includes(key) ? (
                                      <Badge variant="destructive" className="text-xs">必填</Badge>
                                    ) : (
                                      <Badge variant="secondary" className="text-xs">可选</Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      {Object.keys(tool.returns).length > 0 && (
                        <div>
                          <Label className="text-xs text-gray-500">返回字段</Label>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {Object.entries(tool.returns).map(([key, desc]) => (
                              <div key={key} className="text-xs bg-gray-100 px-2 py-1 rounded">
                                <code className="font-medium">{key}</code>: {desc}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>在线测试</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>选择工具</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {tools.map((tool) => (
                    <Button
                      key={tool.name}
                      variant={selectedTool?.name === tool.name ? "default" : "outline"}
                      size="sm"
                      onClick={() => openToolDialog(tool)}
                    >
                      {tool.name}
                    </Button>
                  ))}
                </div>
              </div>

              {selectedTool && (
                <>
                  <div>
                    <Label>参数 (JSON)</Label>
                    <Textarea
                      value={params}
                      onChange={(e) => setParams(e.target.value)}
                      rows={8}
                      className="font-mono text-sm"
                    />
                  </div>

                  <Button onClick={handleCallTool} disabled={calling}>
                    {calling ? "调用中..." : "执行调用"}
                  </Button>

                  {callResult && (
                    <div>
                      <Label>执行结果</Label>
                      <pre className="mt-2 p-4 bg-gray-100 rounded-lg overflow-auto max-h-96 font-mono text-sm">
                        {callResult}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>调用历史</CardTitle>
            </CardHeader>
            <CardContent>
              {callLogs.length === 0 ? (
                <div className="text-center py-4 text-gray-500">暂无调用记录</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>工具</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>参数</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {callLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm">
                          {new Date(log.timestamp).toLocaleTimeString("zh-CN")}
                        </TableCell>
                        <TableCell className="font-mono">{log.tool}</TableCell>
                        <TableCell>
                          <Badge variant={log.status === "success" ? "default" : "destructive"}>
                            {log.status === "success" ? "成功" : "失败"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-mono max-w-[200px] truncate">
                          {JSON.stringify(log.params)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedTool?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{selectedTool?.description}</p>

            {selectedTool && Object.keys(selectedTool.returns).length > 0 && (
              <div>
                <Label>返回字段</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {Object.entries(selectedTool.returns).map(([key, desc]) => (
                    <div key={key} className="text-xs bg-gray-100 px-2 py-1 rounded">
                      <code className="font-medium">{key}</code>: {desc}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            <div>
              <Label>参数 (JSON)</Label>
              <Textarea
                value={params}
                onChange={(e) => setParams(e.target.value)}
                rows={6}
                className="font-mono text-sm"
              />
            </div>

            <Button onClick={handleCallTool} disabled={calling} className="w-full">
              {calling ? "调用中..." : "执行调用"}
            </Button>

            {callResult && (
              <div>
                <Label>执行结果</Label>
                <pre className="mt-2 p-4 bg-gray-100 rounded-lg overflow-auto max-h-60 font-mono text-sm">
                  {callResult}
                </pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
