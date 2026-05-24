"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchDailyDigests, triggerDailyCrawl } from "@/lib/api";
import type { DailyPaperDigest, Paper } from "@/lib/types";

function formatDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00`));
}

function scoreTone(score: number) {
  if (score >= 8) return "text-[var(--accent-green)] bg-green-900/20";
  if (score >= 6) return "text-[var(--accent-orange)] bg-orange-900/20";
  return "text-[var(--accent-blue)] bg-sky-900/20";
}

function MiniPaperCard({ paper }: { paper: Paper }) {
  const authors = paper.authors.slice(0, 2).join(", ");
  const score = paper.scores?.recommendation ?? 0;

  return (
    <article className="group min-h-[210px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 transition-colors hover:border-[var(--accent-blue)]/60">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="truncate text-xs text-[var(--accent-blue)]">
          {paper.matched_domain || paper.categories?.[0] || "arXiv"}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${scoreTone(score)}`}>
          {score.toFixed(1)}
        </span>
      </div>
      <h3 className="line-clamp-3 text-sm font-semibold leading-snug text-white group-hover:text-[var(--accent-blue)]">
        {paper.title}
      </h3>
      <p className="mt-2 line-clamp-1 text-xs text-[var(--text-secondary)]">
        {authors}
        {paper.authors.length > 2 ? " et al." : ""}
      </p>
      <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        {paper.summary || paper.original_abstract}
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {paper.matched_keywords.slice(0, 3).map((keyword) => (
          <span
            key={keyword}
            className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
          >
            {keyword}
          </span>
        ))}
      </div>
      <div className="mt-4 flex gap-2 border-t border-[var(--border)] pt-3">
        <a
          href={paper.arxiv_url || paper.pdf_url}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-bold text-[var(--bg-primary)]"
        >
          查看论文
        </a>
        {paper.pdf_url && (
          <a
            href={paper.pdf_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-blue)]/60"
          >
            PDF
          </a>
        )}
      </div>
    </article>
  );
}

function DigestSection({ digest }: { digest: DailyPaperDigest }) {
  return (
    <section className="border-b border-[var(--border)] px-4 py-6 lg:px-8">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            Daily crawl
          </p>
          <h2 className="mt-1 text-xl font-bold text-white">
            {formatDate(digest.date)}
          </h2>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span>{digest.total} papers</span>
          {digest.updatedAt && (
            <span>updated {new Date(digest.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {digest.papers.map((paper) => (
          <MiniPaperCard key={paper.arxiv_id} paper={paper} />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const [digests, setDigests] = useState<DailyPaperDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crawling, setCrawling] = useState(false);
  const [crawlMessage, setCrawlMessage] = useState<string | null>(null);

  const loadDigests = useCallback(async (cancelled?: () => boolean) => {
    try {
      const data = await fetchDailyDigests();
      if (!cancelled?.()) setDigests(data.digests);
    } catch (err) {
      if (!cancelled?.()) setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      if (!cancelled?.()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      loadDigests(() => cancelled);
    });

    return () => {
      cancelled = true;
    };
  }, [loadDigests]);

  const latest = useMemo(() => digests[0], [digests]);

  const handleManualCrawl = async () => {
    setCrawling(true);
    setCrawlMessage(null);
    setError(null);
    try {
      const result = await triggerDailyCrawl();
      setCrawlMessage(
        result.reused
          ? `今天已经爬取过，已读取 ${result.total} 篇缓存论文。`
          : `爬取完成，写入 ${result.total} 篇论文。`
      );
      setLoading(true);
      await loadDigests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manual crawl failed");
    } finally {
      setCrawling(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg-primary)]">
      <header className="border-b border-[var(--border)] px-4 py-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--accent-blue)]">
              evil-read-arxiv
            </p>
            <h1 className="mt-2 text-2xl font-bold text-white lg:text-4xl">
              每日新爬取论文
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
              这里按日期展示自动爬取并缓存的推荐论文。每天的结果会先进入缓存，再以小卡片形式沉淀下来，方便快速扫读和回看。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleManualCrawl}
              disabled={crawling}
              className="rounded-lg bg-[var(--accent-green)] px-4 py-2 text-sm font-bold text-[var(--bg-primary)] disabled:opacity-60"
            >
              {crawling ? "爬取中..." : "手动爬取今日"}
            </button>
            <Link
              href="/papers"
              className="rounded-lg bg-[var(--accent-blue)] px-4 py-2 text-sm font-bold text-[var(--bg-primary)]"
            >
              打开阅读器
            </Link>
            {latest && (
              <a
                href={`/api/papers?date=${latest.date}`}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:border-[var(--accent-blue)]/60"
              >
                查看今日 JSON
              </a>
            )}
          </div>
        </div>
        {crawlMessage && (
          <p className="mx-auto mt-4 max-w-7xl text-sm text-[var(--accent-green)]">
            {crawlMessage}
          </p>
        )}
      </header>

      {loading && (
        <div className="flex min-h-[420px] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent" />
        </div>
      )}

      {error && (
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <p className="text-[var(--accent-red)]">{error}</p>
        </div>
      )}

      {!loading && !error && digests.length === 0 && (
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h2 className="text-xl font-bold text-white">还没有每日爬取缓存</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            运行 `python scripts/daily_crawl.py` 后，这里会显示当天爬到的论文卡片。
          </p>
        </div>
      )}

      {!loading && !error && digests.map((digest) => (
        <DigestSection key={digest.cacheKey} digest={digest} />
      ))}
    </div>
  );
}
