# Docker deployment

This compose stack runs only the Next.js app and the daily cron trigger. MySQL and MinIO are expected to be external services, for example running on your NAS.

## 1. Prepare configuration

```bash
cp .env.example .env
```

Edit `.env` and set strong values for:

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `MINIO_ENDPOINT`
- `MINIO_PORT`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET`
- `ANTHROPIC_API_KEY`

Use addresses that are reachable from the cloud server. Inside a container, `127.0.0.1` points to the app container itself, so do not use it unless MySQL or MinIO is in the same container network. For NAS services, use your NAS LAN/VPN/tunnel address or domain.

`MINIO_ENDPOINT` should be only the host name or IP, without `http://` or `https://`. Use `MINIO_USE_SSL=true` if the NAS MinIO endpoint is HTTPS.

Review `config.yaml` before the first crawl.

## 2. Start

```bash
docker compose up -d --build
```

Open:

- App: `http://SERVER_IP:3000`

## 3. Check logs

```bash
docker compose logs -f evil-read-arxiv
docker compose ps
```

The app initializes MySQL tables and the MinIO bucket on startup using the NAS connection settings from `.env`. Local fallback/cache data is stored under `./data`.

## 4. Daily crawl

The container runs cron at `18:00` Asia/Shanghai time and calls:

```text
POST /api/crawl/daily
```

Manual trigger:

```bash
curl -X POST http://127.0.0.1:3000/api/crawl/daily \
  -H 'Content-Type: application/json' \
  -d '{"triggerType":"manual","force":true}'
```

## 5. Upgrade

```bash
git pull
docker compose up -d --build
```

## 6. GitHub Actions CI/CD

The workflow in `.github/workflows/ci-cd.yml` does two things:

- Pull requests: run `npm ci`, `npm run lint`, and `npm run build`.
- Pushes to `main` or `master`: run CI, upload the source bundle to the server, then run `docker compose up -d --build`.

Add these repository secrets in GitHub:

- `ALIYUN_HOST`: your Alibaba Cloud server IP or domain.
- `ALIYUN_USER`: SSH user, for example `root` or `ecs-user`.
- `ALIYUN_PORT`: SSH port. Optional; defaults to `22` when empty.
- `ALIYUN_SSH_PRIVATE_KEY`: private key for SSH deployment.
- `ALIYUN_DEPLOY_PATH`: deployment directory on the server, for example `/opt/evil-read-arxiv`.
- `ALIYUN_APP_ENV`: optional full `.env` file content. When set, the workflow writes it to `$ALIYUN_DEPLOY_PATH/.env` before deploying. When omitted, an existing server-side `.env` is required.

Prepare the server once:

```bash
sudo mkdir -p /opt/evil-read-arxiv
sudo chown -R "$USER":"$USER" /opt/evil-read-arxiv
cd /opt/evil-read-arxiv
```

Create `.env` in that directory before the first GitHub Actions deployment, or set the `ALIYUN_APP_ENV` repository secret to the full `.env` content. `config.yaml` is uploaded from the repository by default. The workflow intentionally does not upload local `.env`, `data`, or Git history.

For SSH key setup:

```bash
ssh-keygen -t ed25519 -C "github-actions-evil-read-arxiv" -f ~/.ssh/evil_read_arxiv_deploy
cat ~/.ssh/evil_read_arxiv_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/evil_read_arxiv_deploy
```

Put the private key output into `ALIYUN_SSH_PRIVATE_KEY`.
