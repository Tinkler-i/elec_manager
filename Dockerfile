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

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
