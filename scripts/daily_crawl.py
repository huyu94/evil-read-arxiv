#!/usr/bin/env python
"""Run the daily arXiv crawl and warm the web cache.

This script is intentionally small: the project already owns the search and
ranking logic in start-my-day/scripts/search_arxiv.py. Here we call it, normalize
the result into the shape expected by the Next.js app, and save it under
data/papers_cache so the web dashboard can render daily cards immediately.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SEARCH_SCRIPT = ROOT / "start-my-day" / "scripts" / "search_arxiv.py"
DEFAULT_CONFIG = ROOT / "config.yaml"
CACHE_DIR = ROOT / "data" / "papers_cache"


def normalize_paper(raw: dict[str, Any]) -> dict[str, Any]:
    arxiv_id = raw.get("arxiv_id") or ""
    if not arxiv_id:
        raw_url = raw.get("url") or raw.get("id") or ""
        arxiv_id = raw_url.rsplit("/abs/", 1)[-1] if "/abs/" in raw_url else raw_url

    summary = raw.get("summary") or raw.get("abstract") or ""
    return {
        "arxiv_id": arxiv_id,
        "title": raw.get("title") or "",
        "authors": raw.get("authors") or [],
        "affiliations": raw.get("affiliations") or [],
        "summary": summary,
        "original_abstract": summary,
        "published_date": raw.get("published") or raw.get("published_date") or "",
        "categories": raw.get("categories") or [],
        "matched_domain": raw.get("matched_domain") or "",
        "matched_keywords": raw.get("matched_keywords") or [],
        "scores": raw.get("scores")
        or {
            "relevance": 0,
            "recency": 0,
            "popularity": 0,
            "quality": 0,
            "recommendation": 0,
        },
        "pdf_url": raw.get("pdf_url") or (f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else ""),
        "arxiv_url": raw.get("url")
        or raw.get("id")
        or (f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else ""),
    }


def run_search(args: argparse.Namespace) -> dict[str, Any]:
    command = [
        sys.executable,
        str(SEARCH_SCRIPT),
        "--config",
        str(args.config),
        "--output",
        "-",
        "--top-n",
        str(args.top_n),
        "--target-date",
        args.date,
        "--days",
        str(args.days),
        "--categories",
        args.categories,
    ]

    if args.skip_hot_papers:
        command.append("--skip-hot-papers")
    if args.focus:
        command.extend(["--focus", args.focus])

    try:
        completed = subprocess.run(
            command,
            cwd=SEARCH_SCRIPT.parent.parent,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except subprocess.CalledProcessError as exc:
        if exc.stdout and exc.stdout.strip():
            return json.loads(exc.stdout)
        if exc.stderr:
            sys.stderr.write(exc.stderr)
        return {"top_papers": []}

    return json.loads(completed.stdout)


def write_cache(target_date: str, lang: str, papers: list[dict[str, Any]]) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"{target_date}_day_{lang}.json"
    payload = {
        "date": target_date,
        "papers": papers,
        "total": len(papers),
    }
    cache_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return cache_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Warm the daily paper cache for the web app.")
    parser.add_argument("--date", default=date.today().isoformat(), help="Target date, YYYY-MM-DD.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="Path to config.yaml.")
    parser.add_argument("--top-n", type=int, default=10, help="Number of papers to keep.")
    parser.add_argument("--days", type=int, default=1, help="How many days back to search.")
    parser.add_argument(
        "--categories",
        default="cs.AI,cs.LG,cs.CL,cs.CV,cs.MM,cs.MA,cs.RO",
        help="Comma-separated arXiv categories.",
    )
    parser.add_argument("--focus", default="", help="Optional focused search terms.")
    parser.add_argument("--lang", default="zh", choices=["zh", "en"], help="Cache language key.")
    parser.add_argument(
        "--skip-hot-papers",
        action="store_true",
        help="Skip Semantic Scholar hot-paper search for a lighter daily crawl.",
    )
    args = parser.parse_args()

    result = run_search(args)
    papers = [normalize_paper(paper) for paper in result.get("top_papers", [])]
    cache_path = write_cache(args.date, args.lang, papers)

    print(json.dumps({
        "date": args.date,
        "total": len(papers),
        "cache_path": str(cache_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
