# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# 电表管理系统 —— 自洽的多阶段构建
#
# 核心原则：镜像在容器里自己装依赖、自己编译，不复用宿主机上的 .next 产物。
#
# 为什么必须这样：better-sqlite3 是原生模块，产物是平台相关的二进制。宿主机
# （Windows）编出来的是 PE 文件，塞进 Linux 镜像必然 ERR_DLOPEN_FAILED；即使在
# Linux 上编，glibc 与 musl 也不通用。原来那份 Dockerfile 直接 COPY 宿主机
# .next/standalone，属于「build 得出来但跑不起来」。
#
# 基础镜像与 npm 源都可以覆盖。NODE_IMAGE 只能换成同一套 alpine 镜像的镜像站 ——
# 换成 Debian 系的 node 镜像，下面的 apk add 会直接失败。
#
# 下面这个镜像站实测可用（2026-10-06，本机 Windows / 国内网络，走 Registry v2 API 核对：
# index、arm64 子 manifest、4 个 layer blob 全部 200；与 1ms.run、1panel.live 两个镜像站
# 返回的 index digest 完全相同 sha256:0a7108bf…e402，说明转发的是同一个上游镜像）。
# 它是 Docker Hub 的第三方代理：镜像内容一致，但拉取要经过第三方。在意这点就别用代理，
# 或者把 NODE_IMAGE 钉到 digest。你的网络未必和这次实测相同，换之前先 docker pull 确认一次。
#
#   docker build \
#     --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine \
#     --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#     -t elec-meter .
#
# 这里原来推荐的是 registry.cn-hangzhou.aliyuncs.com/library/node:22-alpine，实测不通：
# token 能签发，但 pull 返回 UNAUTHORIZED（code=UNAUTHORIZED, Name=library/node）。
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── 依赖 ────────────────────────────────────────────────────────────────────
FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
# prebuild-install 找不到匹配的预编译包时，better-sqlite3 会退回 node-gyp 现场编译，
# 需要 python3 / make / g++。只装在构建阶段，不进最终镜像。
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm ci --no-audit --no-fund

# ── 构建 ────────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── 运行 ────────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=16543 \
    HOSTNAME=0.0.0.0 \
    ELEC_DB_PATH=/app/data/elec.db \
    ELEC_BACKUP_DIR=/app/data/backups
RUN apk add --no-cache dumb-init \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# standalone 产物不含 static 与 public，要单独搬。
# .next/node_modules 里那批哈希目录（better-sqlite3-<hash>）必须原样保留 ——
# Turbopack 编译出来的服务端代码就是按哈希名 require 的，删了会 ERR_MODULE_NOT_FOUND。
# （飞牛打包删掉它们是因为 fnpack 的 copy_file_range bug，Docker 这边没有这个约束。）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 16543

# 未登录访问 /api/auth/check 返回 401，说明 HTTP 层已经起来了；
# 5xx 或连不上才算不健康。
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||16543)+'/api/auth/check').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
