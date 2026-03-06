FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor ./vendor

# npm@10 在当前 lockfile（含本地 link 依赖）下会触发 arborist 解析错误。
# 固定 npm@8 并跳过 Electron 二进制下载，避免构建期无用下载与权限问题。
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    npm_config_cache=/tmp/.npm
RUN npm install -g npm@8.19.4 && \
    npm ci --no-audit --fund=false && \
    npm install --no-save @rollup/rollup-linux-x64-gnu

COPY . .

ARG VITE_BACKEND_PORT=18011
ENV VITE_BACKEND_PORT=${VITE_BACKEND_PORT}
RUN npm run build

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
