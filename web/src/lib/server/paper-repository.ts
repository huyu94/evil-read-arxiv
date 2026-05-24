import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { DailyPaperDigest, Paper, PaperAnalysis, PapersResponse } from "@/lib/types";
import { isDatabaseConfigured, withConnection, withTransaction } from "./db";

type PaperRow = RowDataPacket & {
  id: number;
  arxiv_id: string;
  title: string;
  authors: string;
  abstract: string;
  published_date: string | null;
  categories: string;
  arxiv_url: string;
  pdf_url: string;
  matched_domain?: string;
  matched_keywords?: string;
  score?: string | number;
  rank_num?: number;
  contribution?: string | null;
  innovation?: string | null;
  method?: string | null;
  results?: string | null;
};

type CrawlRunRow = RowDataPacket & {
  id: number;
  target_date: string;
  status: "pending" | "running" | "success" | "failed";
  trigger_type: "cron" | "manual" | "api";
  total_found: number;
  total_saved: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
};

function jsonArray(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToPaper(row: PaperRow): Paper {
  const score = Number(row.score ?? 0);
  return {
    arxiv_id: row.arxiv_id,
    title: row.title,
    authors: parseJsonArray(row.authors),
    affiliations: [],
    summary: row.abstract,
    original_abstract: row.abstract,
    highlights: row.contribution
      ? {
          contribution: row.contribution || "",
          innovation: row.innovation || "",
          method: row.method || "",
          results: row.results || "",
        }
      : undefined,
    published_date: row.published_date || "",
    categories: parseJsonArray(row.categories),
    matched_domain: row.matched_domain || "",
    matched_keywords: parseJsonArray(row.matched_keywords),
    scores: {
      relevance: 0,
      recency: 0,
      popularity: 0,
      quality: 0,
      recommendation: score,
    },
    pdf_url: row.pdf_url,
    arxiv_url: row.arxiv_url,
  };
}

export async function getCrawlRun(targetDate: string) {
  if (!isDatabaseConfigured()) return null;
  return withConnection(async (conn) => {
    const [rows] = await conn.query<CrawlRunRow[]>(
      "SELECT * FROM crawl_runs WHERE target_date = ? LIMIT 1",
      [targetDate]
    );
    return rows[0] || null;
  });
}

export async function startCrawlRun(
  targetDate: string,
  triggerType: "cron" | "manual" | "api"
) {
  return withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO crawl_runs (target_date, status, trigger_type, started_at)
       VALUES (?, 'running', ?, NOW())
       ON DUPLICATE KEY UPDATE
         status = IF(status = 'success', status, 'running'),
         trigger_type = IF(status = 'success', trigger_type, VALUES(trigger_type)),
         started_at = IF(status = 'success', started_at, NOW()),
         finished_at = IF(status = 'success', finished_at, NULL),
         error_message = IF(status = 'success', error_message, NULL)`,
      [targetDate, triggerType]
    );

    const [rows] = await conn.query<CrawlRunRow[]>(
      "SELECT * FROM crawl_runs WHERE target_date = ? LIMIT 1",
      [targetDate]
    );
    return rows[0];
  });
}

export async function finishCrawlRun(
  targetDate: string,
  status: "success" | "failed",
  totals: { totalFound?: number; totalSaved?: number; errorMessage?: string }
) {
  if (!isDatabaseConfigured()) return;
  await withConnection(async (conn) => {
    await conn.query(
      `UPDATE crawl_runs
       SET status = ?, total_found = ?, total_saved = ?, error_message = ?, finished_at = NOW()
       WHERE target_date = ?`,
      [
        status,
        totals.totalFound || 0,
        totals.totalSaved || 0,
        totals.errorMessage || null,
        targetDate,
      ]
    );
  });
}

async function upsertPaper(conn: PoolConnection, paper: Paper): Promise<number> {
  await conn.query(
    `INSERT INTO papers
      (arxiv_id, title, authors, abstract, published_date, categories, arxiv_url, pdf_url, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'arxiv')
     ON DUPLICATE KEY UPDATE
      title = VALUES(title),
      authors = VALUES(authors),
      abstract = VALUES(abstract),
      published_date = VALUES(published_date),
      categories = VALUES(categories),
      arxiv_url = VALUES(arxiv_url),
      pdf_url = VALUES(pdf_url)`,
    [
      paper.arxiv_id,
      paper.title,
      jsonArray(paper.authors),
      paper.original_abstract || paper.summary || "",
      paper.published_date ? paper.published_date.slice(0, 10) : null,
      jsonArray(paper.categories),
      paper.arxiv_url,
      paper.pdf_url,
    ]
  );

  const [rows] = await conn.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM papers WHERE arxiv_id = ? LIMIT 1",
    [paper.arxiv_id]
  );
  return rows[0].id;
}

export async function saveDailyPapers(
  targetDate: string,
  crawlRunId: number,
  papers: Paper[]
) {
  return withTransaction(async (conn) => {
    await conn.query("DELETE FROM daily_papers WHERE target_date = ?", [targetDate]);

    const paperIds: number[] = [];
    for (let i = 0; i < papers.length; i++) {
      const paper = papers[i];
      const paperId = await upsertPaper(conn, paper);
      paperIds.push(paperId);
      await conn.query(
        `INSERT INTO daily_papers
          (target_date, crawl_run_id, paper_id, rank_num, score, matched_domain, matched_keywords)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          crawl_run_id = VALUES(crawl_run_id),
          rank_num = VALUES(rank_num),
          score = VALUES(score),
          matched_domain = VALUES(matched_domain),
          matched_keywords = VALUES(matched_keywords)`,
        [
          targetDate,
          crawlRunId,
          paperId,
          i + 1,
          paper.scores.recommendation || 0,
          paper.matched_domain || "",
          jsonArray(paper.matched_keywords),
        ]
      );
    }
    return paperIds;
  });
}

export async function getDailyPapersFromDb(targetDate: string): Promise<PapersResponse | null> {
  if (!isDatabaseConfigured()) return null;
  return withConnection(async (conn) => {
    const [rows] = await conn.query<PaperRow[]>(
      `SELECT p.*, dp.matched_domain, dp.matched_keywords, dp.score, dp.rank_num,
              pa.contribution, pa.innovation, pa.method, pa.results
       FROM daily_papers dp
       JOIN papers p ON p.id = dp.paper_id
       LEFT JOIN paper_analyses pa ON pa.paper_id = p.id AND pa.status = 'success'
       WHERE dp.target_date = ?
       ORDER BY dp.rank_num ASC`,
      [targetDate]
    );

    if (rows.length === 0) return null;
    return {
      date: targetDate,
      papers: rows.map(rowToPaper),
      total: rows.length,
    };
  });
}

export async function getDailyDigestsFromDb(
  limit = 14,
  papersPerDay = 6
): Promise<DailyPaperDigest[] | null> {
  if (!isDatabaseConfigured()) return null;
  return withConnection(async (conn) => {
    const [dates] = await conn.query<(RowDataPacket & { target_date: string; total: number })[]>(
      `SELECT target_date, COUNT(*) AS total
       FROM daily_papers
       GROUP BY target_date
       ORDER BY target_date DESC
       LIMIT ?`,
      [limit]
    );

    const digests: DailyPaperDigest[] = [];
    for (const dateRow of dates) {
      const targetDate = String(dateRow.target_date).slice(0, 10);
      const daily = await getDailyPapersFromDb(targetDate);
      if (!daily) continue;
      digests.push({
        date: targetDate,
        total: Number(dateRow.total),
        papers: daily.papers.slice(0, papersPerDay),
        cacheKey: `${targetDate}_db`,
      });
    }
    return digests;
  });
}

export async function getPaperIdByArxivId(arxivId: string) {
  if (!isDatabaseConfigured()) return null;
  return withConnection(async (conn) => {
    const [rows] = await conn.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM papers WHERE arxiv_id = ? LIMIT 1",
      [arxivId]
    );
    return rows[0]?.id || null;
  });
}

export async function savePaperAnalysisToDb(
  arxivId: string,
  analysis: PaperAnalysis,
  model: string,
  objectRef?: { bucket: string; objectKey: string }
) {
  if (!isDatabaseConfigured()) return;
  await withConnection(async (conn) => {
    const paperId = await getPaperIdByArxivId(arxivId);
    if (!paperId) return;
    await conn.query(
      `INSERT INTO paper_analyses
        (paper_id, status, model, contribution, innovation, method, results, bucket, object_key)
       VALUES (?, 'success', ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        status = 'success',
        model = VALUES(model),
        contribution = VALUES(contribution),
        innovation = VALUES(innovation),
        method = VALUES(method),
        results = VALUES(results),
        bucket = VALUES(bucket),
        object_key = VALUES(object_key),
        error_message = NULL`,
      [
        paperId,
        model,
        analysis.contribution,
        analysis.innovation,
        analysis.method,
        analysis.results,
        objectRef?.bucket || null,
        objectRef?.objectKey || null,
      ]
    );
  });
}

export async function savePaperAsset(
  paperId: number,
  asset: {
    type: "pdf" | "image" | "analysis_json" | "analysis_md" | "daily_json";
    bucket: string;
    objectKey: string;
    contentType: string;
    size?: number;
  }
) {
  if (!isDatabaseConfigured()) return;
  await withConnection(async (conn) => {
    await conn.query<ResultSetHeader>(
      `INSERT INTO paper_assets
        (paper_id, asset_type, bucket, object_key, content_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [paperId, asset.type, asset.bucket, asset.objectKey, asset.contentType, asset.size || null]
    );
  });
}
