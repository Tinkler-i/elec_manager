# 电表数据管理系统

支持标准 MCP (Model Context Protocol) 协议的电表数据管理系统，可让 AI 助手直接读写电表数据。

## 功能特性

- **读数记录** - 手动输入电表读数，支持初始读数配置
- **数据可视化** - 日用电量、月度趋势、用电统计图表
- **标准 MCP** - 支持 Streamable HTTP 和 Stdio 两种传输方式
- **安全认证** - JWT 自动管理、登录速率限制、安全响应头
- **数据导出** - CSV 格式导出读数数据
- **数据备份** - 一键备份和恢复数据库
- **多平台部署** - Docker / 飞牛 fnOS / Node.js 直接运行
- **双架构支持** - amd64 / arm64 自动构建

## 快速开始

### 本地开发

```bash
git clone https://github.com/Tinkler-i/elec_manager.git
cd elec_manager
npm install
npm run dev
```

访问 http://localhost:16543，默认密码：`admin`

### Docker 部署

```bash
# 使用 docker compose
docker compose up -d

# 或单独构建
docker build -t elec-meter .
docker run -d -p 16543:16543 -v elec-data:/app/data elec-meter
```

### 飞牛 fnOS

从 [Releases](https://github.com/Tinkler-i/elec_manager/releases) 下载对应架构的 fpk 文件，在飞牛设备的应用中心手动安装。

文件命名格式：`elec-meter-v{版本}-{架构}.fpk`（如 `elec-meter-v1.0.0-amd64.fpk`）。

也可在本地构建：

```bash
cd fnos
./build.sh
```

### Node.js 直接运行

```bash
npm run build
cd .next/standalone
node server.js
```

## 安全特性

| 特性 | 说明 |
|------|------|
| JWT 自动管理 | 首次启动自动生成密钥，持久化存储，重启不失效 |
| 登录速率限制 | 同一 IP 15 分钟内最多 10 次尝试 |
| 安全响应头 | X-Frame-Options、X-Content-Type-Options 等 |
| 输入验证 | 读数值、日期格式、密码长度校验 |
| 设置白名单 | 敏感配置项（如密码）不可通过 API 修改 |

## MCP 接入

### 方式一：Streamable HTTP（推荐）

适用于 Claude Desktop、Cursor 等支持 MCP 的客户端。

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

### 方式二：Stdio

```json
{
  "mcpServers": {
    "elec-meter": {
      "command": "npx",
      "args": ["tsx", "path/to/mcp-server.ts"],
      "env": {
        "ELEC_DB_PATH": "/path/to/data/elec.db"
      }
    }
  }
}
```

### 获取 Token

1. 登录系统
2. 访问 `/mcp` 页面查看配置说明
3. 复制 Token

### MCP 工具列表

| 工具 | 说明 |
|------|------|
| `add_reading` | 记录电表读数 |
| `list_readings` | 查询读数记录 |
| `get_statistics` | 获取用电统计概览 |
| `export_readings` | 导出读数数据（CSV） |
| `create_backup` | 创建数据库备份 |
| `get_settings` | 查看系统配置 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | JWT 密钥 | 自动生成并持久化 |
| `ELEC_DB_PATH` | 数据库路径 | `data/elec.db` |
| `PORT` | 服务端口 | `16543` |
| `HOSTNAME` | 绑定地址 | `0.0.0.0` |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/login | 登录 |
| POST | /api/auth/logout | 登出 |
| GET | /api/auth/check | 检查认证状态 |
| PUT | /api/auth/password | 修改密码 |
| GET/POST | /api/auth/token | 获取/刷新 Token |
| GET | /api/stats | 统计数据 |
| GET/POST | /api/readings | 读数列表/添加读数 |
| GET/PUT/DELETE | /api/readings/[id] | 读数详情 |
| PUT | /api/readings/recalculate | 重新计算用电量 |
| GET/PUT | /api/settings | 设置管理 |
| GET/POST | /api/backup | 备份管理 |
| DELETE | /api/backup | 删除备份 |
| GET | /api/export | 数据导出（CSV） |
| POST/GET/DELETE | /api/mcp | MCP Streamable HTTP 端点 |
| GET | /api/mcp/tools | MCP 工具元数据 |

## 技术栈

- **前端**: Next.js 16 + React 19 + TypeScript + Tailwind CSS
- **UI**: shadcn/ui + Lucide Icons
- **图表**: Chart.js + react-chartjs-2
- **数据库**: SQLite (better-sqlite3)
- **认证**: JWT (jsonwebtoken + jose) + bcryptjs
- **MCP**: @modelcontextprotocol/sdk
- **CI/CD**: GitHub Actions（双架构自动构建 amd64/arm64）

## 项目结构

```
elec/
├── src/
│   ├── app/              # Next.js 页面和 API 路由
│   ├── components/       # React 组件（图表、UI）
│   ├── lib/              # 工具函数、数据库、MCP
│   ├── types/            # TypeScript 类型定义
│   └── proxy.ts          # 全局认证代理（Next.js 16）
├── mcp-server.ts         # MCP Stdio 服务器
├── fnos/                 # 飞牛 fnOS 应用配置
├── Dockerfile            # Docker 构建
└── docker-compose.yml    # Docker Compose 配置
```

## License

MIT
