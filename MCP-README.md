# 电表管理系统 MCP 接入指南

本项目实现了标准 MCP (Model Context Protocol) 服务器，支持 Streamable HTTP 和 Stdio 两种传输方式。

## 方式一：Streamable HTTP（推荐）

适用于已部署的电表系统，客户端通过 HTTP 连接。

### 配置示例

**Claude Desktop** (`claude_desktop_config.json`)：

```json
{
  "mcpServers": {
    "elec-meter": {
      "url": "http://your-server:16543/api/mcp",
      "headers": {
        "Authorization": "Bearer 你的token"
      }
    }
  }
}
```

### 获取 Token

1. 登录电表系统（默认密码 `admin`）
2. 进入 MCP 页面（`/mcp`）查看完整配置
3. 复制 Token

## 方式二：Stdio

适用于本地开发，客户端直接启动 MCP 进程，直连数据库。

### 配置示例

**Claude Desktop** (`claude_desktop_config.json`)：

```json
{
  "mcpServers": {
    "elec-meter": {
      "command": "npx",
      "args": ["tsx", "path/to/elec_manager/mcp-server.ts"],
      "env": {
        "ELEC_DB_PATH": "path/to/data/elec.db"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`)：

```json
{
  "mcpServers": {
    "elec-meter": {
      "command": "npx",
      "args": ["tsx", "path/to/elec_manager/mcp-server.ts"],
      "env": {
        "ELEC_DB_PATH": "path/to/data/elec.db"
      }
    }
  }
}
```

> Stdio 模式直连数据库，无需 token 认证，适合本地开发使用。

## 可用工具

| 工具 | 说明 | 示例对话 |
|------|------|----------|
| `add_reading` | 记录电表读数 | "帮我记录今天电表读数是 1250" |
| `list_readings` | 查询读数记录 | "查一下上个月的读数" |
| `get_statistics` | 获取用电统计 | "本月用了多少电？" |
| `export_readings` | 导出数据 | "导出所有读数数据" |
| `create_backup` | 创建备份 | "备份一下数据库" |
| `get_settings` | 查看配置 | "现在电价是多少？" |

## 对话示例

```
用户：帮我查一下这个月用了多少电
AI：[调用 get_statistics]
AI：本月用电 150 度，费用 84 元，累计用电 1200 度。

用户：记录今天电表读数 1350
AI：[调用 add_reading]
AI：已记录，本次用电 100 度。

用户：上个月用了多少？
AI：[调用 list_readings，筛选上月日期]
AI：上个月共读数 5 次，用电 180 度，费用 100.8 元。
```

## 环境变量

| 变量 | 说明 | 适用模式 |
|------|------|----------|
| `ELEC_DB_PATH` | 数据库文件路径 | Stdio |
| `Authorization` | Bearer Token 认证头 | Streamable HTTP |

## 常见问题

**Q: AI 没有识别到工具？**
A: 检查配置文件路径是否正确，重启 AI 客户端。

**Q: Stdio 模式报错？**
A: 确保 `ELEC_DB_PATH` 指向正确的数据库文件，且已安装 `tsx`。

**Q: HTTP 模式认证失败？**
A: 检查 Token 是否正确，Token 可在系统 MCP 页面获取。

**Q: 可以远程访问吗？**
A: Streamable HTTP 模式天然支持远程访问，只需配置正确的服务器地址。
