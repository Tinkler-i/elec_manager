# 电表管理系统 MCP 接入指南

本项目实现了标准的 MCP (Model Context Protocol) 服务器，可以让 AI 助手（如 Claude Desktop、Cursor 等）直接读写电表数据。

## 快速开始

### 第一步：启动电表系统

```bash
cd D:\Code\AI\Elec\elec
npm run dev
```

确保 http://localhost:16543 可以访问。

### 第二步：获取登录 Token

1. 打开 http://localhost:3000/login
2. 输入默认密码 `admin` 登录
3. 登录后，打开浏览器开发者工具（F12）
4. 在 Application → Cookies 中找到 `auth_token` 的值
5. 复制这个 token 值备用

### 第三步：配置 AI 客户端

#### Claude Desktop

编辑配置文件：
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

添加以下配置：

```json
{
  "mcpServers": {
    "elec-meter": {
      "command": "npx",
      "args": ["tsx", "D:/Code/AI/Elec/elec/mcp-server.ts"],
      "env": {
        "ELEC_API_URL": "http://localhost:3000",
        "ELEC_AUTH_TOKEN": "你的登录token"
      }
    }
  }
}
```

#### Cursor

在项目根目录创建 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "elec-meter": {
      "command": "npx",
      "args": ["tsx", "D:/Code/AI/Elec/elec/mcp-server.ts"],
      "env": {
        "ELEC_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

### 第三步：重启 AI 客户端

配置完成后重启 Claude Desktop 或 Cursor，AI 就能自动识别电表工具了。

## 可用工具

AI 可以使用以下工具操作电表数据：

| 工具 | 说明 | 示例对话 |
|------|------|----------|
| 添加读数 | 记录电表读数 | "帮我记录今天电表读数是 1250" |
| 获取读数 | 查询读数记录 | "查一下上个月的读数" |
| 用电统计 | 获取用电概览 | "本月用了多少电？" |
| 审计日志 | 查看操作记录 | "看看AI都做过哪些操作" |
| 导出数据 | 导出读数 | "导出所有读数数据" |
| 备份数据库 | 创建备份 | "备份一下数据库" |
| 获取设置 | 查看配置 | "现在电价是多少？" |

## AI 对话示例

```
用户：帮我查一下这个月用了多少电
AI：[调用"用电统计"工具]
AI：本月用电 150 度，费用 84 元，累计用电 1200 度。

用户：记录今天电表读数 1350
AI：[调用"添加读数"工具]
AI：已记录，本次用电 100 度。

用户：上个月用了多少？
AI：[调用"获取读数"工具，筛选上月日期]
AI：上个月共读数 5 次，用电 180 度，费用 100.8 元。
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ELEC_API_URL` | 电表系统地址 | http://localhost:16543 |
| `ELEC_AUTH_TOKEN` | 登录认证token | 空（需要先登录获取） |
| `JWT_SECRET` | JWT密钥 | elec-meter-secret-key-change-in-production |

```
AI 客户端 (Claude Desktop / Cursor)
        │
        │ stdio (JSON-RPC)
        ▼
MCP 服务器 (mcp-server.ts)
        │
        │ HTTP API
        ▼
电表系统 (localhost:3000)
        │
        ▼
SQLite 数据库
```

## 常见问题

**Q: AI 没有识别到工具？**
A: 检查配置文件路径是否正确，重启 AI 客户端。

**Q: 调用工具报错？**
A: 确保电表系统已启动（npm run dev）。

**Q: 可以远程访问吗？**
A: 将 `ELEC_API_URL` 改为服务器地址即可。
