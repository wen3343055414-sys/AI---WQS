FROM node:24-bookworm-slim AS verify
WORKDIR /app

# The project uses only Node.js built-ins, so no package download is needed.
COPY package.json package-lock.json .env.example ./
COPY public/ ./public/
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY tests/ ./tests/
RUN npm test && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=verify --chown=node:node /app/package.json ./
COPY --from=verify --chown=node:node /app/public/ ./public/
COPY --from=verify --chown=node:node /app/src/ ./src/

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(async r => process.exit(r.ok && (await r.json()).status === 'ok' ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "src/server.js"]
