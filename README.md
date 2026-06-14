# 电表数据管理系统

支持标准 MCP (Model Context Protocol) 协议的电表数据管理系统，可让 AI 助手直接读写电表数据。

## 功能特性

- **读数记录** - 手动输入电表读数，支持时间字段区分同天多条记录
- **数据可视化** - 日均用电量、月度趋势、年度对比、用电统计图表
- **标准 MCP** - 10 个 MCP 工具，支持 Streamable HTTP 和 Stdio 两种传输方式
- **批量操作** - 多选批量删除读数记录
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

文件命名格式：`elec-meter-v{版本}-{架构}.fpk`（如 `elec-meter-v1.9.0-amd64.fpk`）。

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

## 数据模型

### 读数记录 (readings)

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT | UUID 主键 |
| `reading_value` | REAL | 电表当前读数 |
| `reading_date` | TEXT | 读数日期 (YYYY-MM-DD) |
| `reading_time` | TEXT | 记录时间 (HH:MM)，可选，用于区分同天多条 |
| `previous_reading` | REAL | 前一条读数的值，用于计算用电量 |
| `units_consumed` | REAL | 用电量（自动生成：`reading_value - COALESCE(previous_reading, 0)`） |
| `notes` | TEXT | 备注 |
| `source` | TEXT | 来源：`manual`(手工) / `mcp`(AI) / `import`(导入) |
| `created_by` | TEXT | 创建者 |
| `is_verified` | INTEGER | 是否已核验 |
| `created_at` | TEXT | 创建时间 |

### 设置 (settings)

| key | 默认值 | 说明 |
|-----|--------|------|
| `rate_per_kwh` | `0.56` | 电价（元/度） |
| `initial_reading` | `0` | 初始读数基准 |

## 数据图表算法

### 日均用电量图表 (`daily-usage-chart`)

**数据来源：** 读数记录表，按日期分组取最后一条。

**算法：**
1. 按天分组读数，同天多条取最后一条
2. 每天的用电量 = 当天最后一条 `reading_value` - 当天第一条 `previous_reading`
3. 日均用电量 = 用电量 / 与上一条读数的间隔天数
4. 第一条读数日均 = 0（无对比基准）

**示例：** 6月1日读数 100，6月5日读数 140 → 用电量 40，间隔 4 天 → 日均 10 度/天

### 仪表盘用电趋势 (`usage-chart`)

**数据来源：** 读数记录表，月边界插值。

**算法：**
1. 取每月最后一条读数
2. 在每月1号做线性插值得到月初读数值
3. 月用电量 = 月末读数 - 月初插值
4. 日均用电量 = 月用电量 / 覆盖天数（月初到最后一条读数的实际天数）

**处理边界情况：**
- 当月未结束：天数 = 月初到最后一条读数的实际天数，非整月天数
- 首月无月初数据：回退到首条读数的 `previous_reading` 作为基准
- 跨月/跨年：插值自动处理

### 月度对比图表 (`monthly-comparison`)

**数据来源：** 读数记录表，按月分组。

**算法：**
1. 取每月最后一条读数
2. 月用电量 = 当月最后读数 - 上月最后读数
3. 首月：用电量 = 最后读数 - 首条读数的 `previous_reading`

### 年度对比图表 (`annual-analysis`)

**数据来源：** 同月度对比，按年分组展示。

### 用电统计 (`stats`)

**数据来源：** 读数记录表。

**算法：**
1. 按月分组取最后一条读数
2. 月用电量 = 当月最后读数 - 上月最后读数
3. 总用电量 = 各月用电量之和
4. 当月用电量 = 当月最后读数 - 上月最后读数

### 读数记录表 (`readings` page)

- **用电量列**：已移除（`units_consumed` 为数据库生成列，读数差值跨天时参考价值有限）
- **费用列**：已移除（可在仪表盘统计中查看）
- **来源标记**：AI（紫色）/ 手工（灰色）/ 导入（橙色）

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
| `add_reading` | 记录电表读数（支持 reading_time） |
| `list_readings` | 查询读数记录（支持日期范围筛选） |
| `get_reading` | 根据 ID 获取单条读数详情 |
| `update_reading` | 编辑读数（值、日期、时间、备注），自动级联修复 |
| `delete_reading` | 删除读数，自动修正前后读数关联 |
| `get_stats` | 获取用电统计概览（总用电、本月用电等） |
| `export_readings` | 导出所有读数数据 |
| `backup_database` | 创建数据库备份 |
| `get_settings` | 查看系统配置（电价、初始读数） |

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
| GET/PUT/DELETE | /api/readings/[id] | 读数详情/编辑/删除 |
| POST | /api/readings/batch-delete | 批量删除读数 |
| POST | /api/readings/recalculate | 重新计算用电量 |
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
