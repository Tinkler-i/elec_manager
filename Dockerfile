FROM registry.cn-hangzhou.aliyuncs.com/library/node:20-alpine

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    apk add --no-cache dumb-init

WORKDIR /app

COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 16543
ENV PORT=16543
ENV HOSTNAME="0.0.0.0"

# 启动脚本：自动生成 JWT_SECRET（如果未设置）
RUN printf '#!/bin/sh\nif [ -z "$JWT_SECRET" ]; then\n  export JWT_SECRET=$(head -c 32 /dev/urandom | base64)\n  echo "WARNING: JWT_SECRET auto-generated. Set it as env var for persistence."\nfi\nexec "$@"\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

ENTRYPOINT ["dumb-init", "--", "/app/entrypoint.sh"]
CMD ["node", "server.js"]
