CREATE TABLE IF NOT EXISTS papers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  arxiv_id VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  authors JSON NOT NULL,
  abstract MEDIUMTEXT NOT NULL,
  published_date DATE NULL,
  categories JSON NOT NULL,
  arxiv_url TEXT NOT NULL,
  pdf_url TEXT NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'arxiv',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_papers_arxiv_id (arxiv_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crawl_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  target_date DATE NOT NULL,
  status ENUM('pending', 'running', 'success', 'failed') NOT NULL,
  trigger_type ENUM('cron', 'manual', 'api') NOT NULL DEFAULT 'api',
  total_found INT NOT NULL DEFAULT 0,
  total_saved INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crawl_runs_target_date (target_date),
  KEY idx_crawl_runs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS daily_papers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  target_date DATE NOT NULL,
  crawl_run_id BIGINT UNSIGNED NOT NULL,
  paper_id BIGINT UNSIGNED NOT NULL,
  rank_num INT NOT NULL,
  score DECIMAL(6,3) NOT NULL DEFAULT 0,
  matched_domain VARCHAR(255) NOT NULL DEFAULT '',
  matched_keywords JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_daily_paper (target_date, paper_id),
  KEY idx_daily_papers_date_rank (target_date, rank_num),
  CONSTRAINT fk_daily_papers_run FOREIGN KEY (crawl_run_id) REFERENCES crawl_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_daily_papers_paper FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS paper_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paper_id BIGINT UNSIGNED NOT NULL,
  asset_type ENUM('pdf', 'image', 'analysis_json', 'analysis_md', 'daily_json') NOT NULL,
  bucket VARCHAR(255) NOT NULL,
  object_key TEXT NOT NULL,
  content_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_paper_assets_paper_type (paper_id, asset_type),
  CONSTRAINT fk_paper_assets_paper FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS paper_analyses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  paper_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'running', 'success', 'failed') NOT NULL DEFAULT 'pending',
  model VARCHAR(255) NOT NULL DEFAULT '',
  summary MEDIUMTEXT NULL,
  contribution MEDIUMTEXT NULL,
  innovation MEDIUMTEXT NULL,
  method MEDIUMTEXT NULL,
  results MEDIUMTEXT NULL,
  bucket VARCHAR(255) NULL,
  object_key TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_paper_analyses_paper (paper_id),
  CONSTRAINT fk_paper_analyses_paper FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
