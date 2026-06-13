"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, Copy, Check, Server, Terminal, Plug } from "lucide-react";
import { toast } from "sonner";

interface McpToolInfo {
  name: string;
  title: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export default function McpPage() {
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetchTools();
    fetchToken();
  }, []);

  async function fetchTools() {
    try {
      const response = await fetch("/api/mcp/tools");
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
      if (!response.ok) return;
      const data = await response.json();
      if (data.token) setToken(data.token);
    } catch (error) {
      console.error("获取token失败:", error);
    }
  }

  function getBaseUrl() {
    if (typeof window === "undefined") return "";
    return `${window.location.protocol}//${window.location.host}`;
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("复制失败");
    }
  }

  function CopyButton({ text, label }: { text: string; label: string }) {
    return (
      <Button variant="outline" size="sm" onClick={() => copyText(text, label)}>
        {copied === label ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </Button>
    );
  }

  const mcpUrl = `${getBaseUrl()}/api/mcp`;

  const streamableHttpConfig = JSON.stringify({
    mcpServers: {
      "elec-meter": {
        url: mcpUrl,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    },
  }, null, 2);

  const stdioConfig = JSON.stringify({
    mcpServers: {
      "elec-meter": {
        command: "npx",
        args: ["tsx", "/path/to/elec/mcp-server.ts"],
        env: {
          ELEC_DB_PATH: "/path/to/data/elec.db",
        },
      },
    },
  }, null, 2);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">MCP 服务</h1>
        <Badge variant="outline" className="text-sm">
          <Plug className="w-3 h-3 mr-1" />
          {tools.length} 个工具
        </Badge>
      </div>

      <Tabs defaultValue="streamable">
        <TabsList>
          <TabsTrigger value="streamable">
            <Server className="w-4 h-4 mr-2" />
            Streamable HTTP
          </TabsTrigger>
          <TabsTrigger value="stdio">
            <Terminal className="w-4 h-4 mr-2" />
            Stdio
          </TabsTrigger>
          <TabsTrigger value="tools">
            <BookOpen className="w-4 h-4 mr-2" />
            工具列表
          </TabsTrigger>
        </TabsList>

        {/* Streamable HTTP 配置 */}
        <TabsContent value="streamable" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Streamable HTTP 连接</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                通过标准 MCP Streamable HTTP 协议连接。适用于支持远程 MCP 服务器的 AI 客户端。
              </p>

              <div>
                <label className="text-sm font-medium text-gray-700">MCP 端点</label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono">
                    {mcpUrl || "加载中..."}
                  </code>
                  <CopyButton text={mcpUrl} label="url" />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">认证 Token</label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-xs font-mono overflow-auto break-all">
                    {token || "获取中..."}
                  </code>
                  <CopyButton text={token} label="token" />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  在请求头中添加 <code className="bg-gray-100 px-1 rounded">Authorization: Bearer &lt;token&gt;</code>
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>客户端配置示例</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Claude Desktop / Cursor / Windsurf</label>
                <div className="flex items-start gap-2 mt-1">
                  <pre className="flex-1 bg-gray-900 text-gray-100 p-4 rounded-lg text-xs font-mono overflow-auto">
                    {streamableHttpConfig}
                  </pre>
                  <CopyButton text={streamableHttpConfig} label="http-config" />
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>提示：</strong>请将配置中的 URL 和 Token 替换为实际值。如果使用反向代理，URL 可能需要调整。
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Stdio 配置 */}
        <TabsContent value="stdio" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Stdio 本地连接</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                通过标准输入/输出 (stdio) 在本地运行 MCP 服务器。适用于 AI 客户端与服务器在同一台机器上的场景。
              </p>

              <div>
                <label className="text-sm font-medium text-gray-700">运行命令</label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono">
                    npx tsx mcp-server.ts
                  </code>
                  <CopyButton text="npx tsx mcp-server.ts" label="cmd" />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700">环境变量</label>
                <Table className="mt-1">
                  <TableHeader>
                    <TableRow>
                      <TableHead>变量名</TableHead>
                      <TableHead>说明</TableHead>
                      <TableHead>默认值</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell><code className="text-xs">ELEC_DB_PATH</code></TableCell>
                      <TableCell className="text-sm">SQLite 数据库文件路径</TableCell>
                      <TableCell><code className="text-xs">data/elec.db</code></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>客户端配置示例</CardTitle>
            </CardHeader>
            <CardContent>
              <div>
                <label className="text-sm font-medium text-gray-700">Claude Desktop / Cursor / Windsurf</label>
                <div className="flex items-start gap-2 mt-1">
                  <pre className="flex-1 bg-gray-900 text-gray-100 p-4 rounded-lg text-xs font-mono overflow-auto">
                    {stdioConfig}
                  </pre>
                  <CopyButton text={stdioConfig} label="stdio-config" />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 工具列表 */}
        <TabsContent value="tools" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>可用工具 ({tools.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-4 text-gray-500">加载中...</div>
              ) : tools.length === 0 ? (
                <div className="text-center py-4 text-gray-500">暂无可用工具</div>
              ) : (
                <div className="space-y-4">
                  {tools.map((tool) => (
                    <div key={tool.name} className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <code className="font-medium text-blue-600 text-sm">{tool.name}</code>
                        <Badge variant="secondary" className="text-xs">{tool.title}</Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-3">{tool.description}</p>

                      {tool.parameters.properties && Object.keys(tool.parameters.properties).length > 0 && (
                        <div>
                          <label className="text-xs font-medium text-gray-500">参数</label>
                          <Table className="mt-1">
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">参数名</TableHead>
                                <TableHead className="text-xs">类型</TableHead>
                                <TableHead className="text-xs">说明</TableHead>
                                <TableHead className="text-xs">必填</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {Object.entries(tool.parameters.properties).map(([key, prop]) => (
                                <TableRow key={key}>
                                  <TableCell><code className="text-xs">{key}</code></TableCell>
                                  <TableCell className="text-xs">{prop.type}</TableCell>
                                  <TableCell className="text-xs">{prop.description}</TableCell>
                                  <TableCell>
                                    {tool.parameters.required?.includes(key) ? (
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
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
