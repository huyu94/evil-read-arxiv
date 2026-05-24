FROM node:22-bookworm AS app

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends cron python3 python3-pip curl \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip3 install --break-system-packages -r requirements.txt

COPY web/package.json web/package-lock.json ./web/
WORKDIR /app/web
RUN npm ci

WORKDIR /app
COPY . .

WORKDIR /app/web
RUN npm run build && npm prune --omit=dev

WORKDIR /app
COPY docker/cron.d/evil-read-arxiv /etc/cron.d/evil-read-arxiv
RUN chmod 0644 /etc/cron.d/evil-read-arxiv && crontab /etc/cron.d/evil-read-arxiv
RUN chmod +x /app/docker/trigger-daily-crawl.sh /app/docker/entrypoint.sh \
  && mkdir -p /app/data/paper_images /app/data/papers_cache

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Shanghai
ENV INIT_STORAGE_ON_START=true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

CMD ["/app/docker/entrypoint.sh"]
