# Daily crawl automation

The app supports two modes:

- Preferred cloud mode: MySQL + MinIO + Docker cron.
- Local fallback mode: JSON cache under `data/papers_cache`.

## Cloud mode

1. Create the MySQL schema:

```bash
mysql -h 127.0.0.1 -P 3306 -u evil_read_arxiv -p evil_read_arxiv < database/schema.sql
```

2. Copy `.env.example` to `.env` and fill in the NAS tunnel endpoints for MySQL
   and MinIO.

3. Start the app:

```bash
docker compose up -d --build
```

The container runs cron internally. At `18:00 Asia/Shanghai` it calls:

```text
POST http://127.0.0.1:3000/api/crawl/daily
```

The page button uses the same endpoint, so manual and scheduled crawls share
the same idempotent workflow.

## Local fallback

Run one crawl manually:

```powershell
python scripts\daily_crawl.py --skip-hot-papers
```

Windows scheduled task example:

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File D:\Workspaces\evil-read-arxiv\scripts\run-daily-crawl.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 08:30
Register-ScheduledTask -TaskName "evil-read-arxiv daily crawl" -Action $action -Trigger $trigger -Description "Warm the daily arXiv paper cache"
```

The script writes `data/papers_cache/YYYY-MM-DD_day_zh.json`, which is what the
dashboard can use when MySQL is not configured. Use `--top-n`, `--days`,
`--focus`, and `--lang en` if you want a different crawl profile.
