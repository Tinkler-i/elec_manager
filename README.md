# 电表数据管理系统

支持 MCP (Model Context Protocol) 的电表数据管理系统，可让 AI 助手直接读写电表数据。

## 功能特性

- **读数记录** - 手动输入电表读数，支持初始读数配置
- **数据可视化** - 日用电量、月度趋势、用电统计图表
- **MCP 集成** - AI 助手可通过 MCP 协议读写数据
- **用户认证** - 密码保护，365天自动登录
- **数据导出** - CSV 格式导出读数数据
- **数据备份** - 一键备份数据库
- **Docker 部署** - 支持容器化部署

## 快速开始

### 本地开发

```bash
# 克隆项目
git clone https://github.com/Tinkler-i/elec_manager.git
cd elec_manager

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000，默认密码：`admin`

### Docker 部署

```bash
# 构建并启动
docker compose up -d

# 或单独构建
docker build -t elec-meter .
docker run -d -p 3000:3000 -v elec-data:/app/data elec-meter
```

## MCP 接入

### Claude Desktop 配置

编辑 `%APPDATA%\Claude\claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "elec-meter": {
      "command": "npx",
      "args": ["tsx", "path/to/mcp-server.ts"],
      "env": {
        "ELEC_API_URL": "http://your-server:3000",
        "ELEC_AUTH_TOKEN": "你的token"
      }
    }
  }
}
```

### 获取 Token

1. 登录系统
2. 访问 `/mcp` 页面
3. 复制 Token

### 可用工具

| 工具 | 说明 |
|------|------|
| 添加读数 | 记录电表读数 |
| 获取读数 | 查询读数记录 |
| 用电统计 | 获取用电概览 |
| 导出数据 | 导出读数数据 |
| 备份数据库 | 创建数据备份 |
| 获取设置 | 查看配置信息 |

## 技术栈

- **前端**: Next.js 16 + React + TypeScript + Tailwind CSS
- **UI 组件**: shadcn/ui
- **图表**: Chart.js + react-chartjs-2
- **数据库**: SQLite + better-sqlite3
- **认证**: JWT + bcryptjs
- **MCP**: @modelcontextprotocol/sdk

## 项目结构

```
elec/
├── src/
│   ├── app/           # Next.js 页面和 API
│   ├── components/    # React 组件
│   ├── lib/           # 工具函数和数据库
│   └── types/         # TypeScript 类型
├── data/              # SQLite 数据库
├── mcp-server.ts      # MCP 服务器
├── Dockerfile         # Docker 构建文件
└── docker-compose.yml # Docker Compose 配置
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | JWT 密钥 | 需要修改 |
| `ELEC_API_URL` | 服务地址 | http://localhost:3000 |
| `ELEC_AUTH_TOKEN` | 认证 Token | 登录后获取 |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/stats | 获取统计数据 |
| GET/POST | /api/readings | 读数列表/添加读数 |
| GET/PUT/DELETE | /api/readings/[id] | 读数详情 |
| GET/PUT | /api/settings | 设置管理 |
| GET/POST | /api/backup | 备份管理 |
| GET | /api/export | 数据导出 |
| POST | /api/mcp | MCP 工具调用 |

## License

MIT
