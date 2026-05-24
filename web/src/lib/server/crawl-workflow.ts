import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { createAnthropicClientWithSettings } from "@/lib/anthropic";
import { cachePapers, getResearchConfig } from "@/lib/data";
import { prompts, type Language } from "@/lib/i18n";
import { searchPapers } from "@/lib/python-bridge";
import type { Paper, PaperAnalysis, PapersResponse } from "@/lib/types";
import { isDatabaseConfigured } from "./db";
import { isObjectStorageConfigured, putJsonObject, putRemoteObject } from "./object-storage";
import {
  finishCrawlRun,
  getCrawlRun,
  getDailyPapersFromDb,
  getPaperIdByArxivId,
  saveDailyPapers,
  savePaperAnalysisToDb,
  savePaperAsset,
  startCrawlRun,
} from "./paper-repository";

export interface CrawlWorkflowResult {
  date: string;
  status: "success" | "running" | "failed";
  reused: boolean;
  total: number;
  papers: Paper[];
  message?: string;
}

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function generateAnalysis(
  paper: Paper,
  client: Anthropic,
  model: string,
  lang: Language
): Promise<PaperAnalysis> {
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: prompts.analyze[lang](
          paper.title,
          paper.original_abstract || paper.summary
        ),
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  try {
    return JSON.parse(text) as PaperAnalysis;
  } catch {
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = codeBlockMatch
      ? codeBlockMatch[1].trim()
      : (text.match(/\{[\s\S]*\}/) || [""])[0];
    return JSON.parse(jsonStr) as PaperAnalysis;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function analyzeTopPapers(papers: Paper[], lang: Language) {
  let client: Anthropic;
  let model: string;
  try {
    const resolved = await createAnthropicClientWithSettings();
    client = resolved.client;
    model = resolved.model;
  } catch (error) {
    console.warn("Skipping top-paper analysis, AI client unavailable:", error);
    return papers;
  }

  const results = [...papers];
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const paper = results[i];
    try {
      const analysis = await withTimeout(
        generateAnalysis(paper, client, model, lang),
        30000,
        `Analysis for ${paper.arxiv_id}`
      );
      results[i] = { ...paper, highlights: analysis };

      let objectRef: { bucket: string; objectKey: string } | undefined;
      if (isObjectStorageConfigured()) {
        const object = await putJsonObject(
          `papers/${paper.arxiv_id}/analysis/${model}/${Date.now()}.json`,
          analysis
        );
        objectRef = { bucket: object.bucket, objectKey: object.objectKey };
      }
      await savePaperAnalysisToDb(paper.arxiv_id, analysis, model, objectRef);
    } catch (error) {
      console.warn(`Top-paper analysis failed for ${paper.arxiv_id}:`, error);
    }
  }
  return results;
}

async function uploadPdfs(papers: Paper[]) {
  if (!isObjectStorageConfigured()) return;

  const uploadOne = async (paper: Paper) => {
    if (!paper.pdf_url) return;
    try {
      const paperId = await getPaperIdByArxivId(paper.arxiv_id);
      if (!paperId) return;
      const object = await putRemoteObject(
        `papers/${paper.arxiv_id}/paper.pdf`,
        paper.pdf_url,
        "application/pdf"
      );
      await savePaperAsset(paperId, {
        type: "pdf",
        bucket: object.bucket,
        objectKey: object.objectKey,
        contentType: object.contentType,
        size: object.size,
      });
    } catch (error) {
      console.warn(`PDF upload failed for ${paper.arxiv_id}:`, error);
    }
  };

  const concurrency = Number(process.env.PDF_UPLOAD_CONCURRENCY || papers.length);
  for (let index = 0; index < papers.length; index += concurrency) {
    const batch = papers.slice(index, index + concurrency);
    await Promise.allSettled(batch.map(uploadOne));
  }
}

export async function runDailyCrawlWorkflow(options: {
  date?: string;
  triggerType?: "cron" | "manual" | "api";
  force?: boolean;
} = {}): Promise<CrawlWorkflowResult> {
  const targetDate = options.date || todayShanghai();
  const triggerType = options.triggerType || "api";

  const existing = await getCrawlRun(targetDate).catch(() => null);
  if (!options.force && existing?.status === "success") {
    const daily = await getDailyPapersFromDb(targetDate);
    return {
      date: targetDate,
      status: "success",
      reused: true,
      total: daily?.total || existing.total_saved,
      papers: daily?.papers || [],
      message: "Daily crawl already completed; reused database content.",
    };
  }

  if (!options.force && existing?.status === "running") {
    return {
      date: targetDate,
      status: "running",
      reused: true,
      total: existing.total_saved,
      papers: [],
      message: "Daily crawl is already running.",
    };
  }

  const run = isDatabaseConfigured()
    ? await startCrawlRun(targetDate, triggerType)
    : null;

  try {
    const config = await getResearchConfig();
    const lang: Language = config.language === "en" ? "en" : "zh";
    const configPath = path.join(process.cwd(), "..", "config.yaml");
    const dailyPaperCount = Number(process.env.DAILY_PAPER_COUNT || 10);
    const papers = await searchPapers(
      targetDate,
      configPath,
      dailyPaperCount,
      ["--skip-hot-papers"],
      1
    );

    const normalized = papers.map((paper) => ({
      ...paper,
      original_abstract: paper.original_abstract || paper.summary,
    }));

    let analyzed = normalized;
    if (isDatabaseConfigured() && run) {
      await saveDailyPapers(targetDate, run.id, normalized);
      // Download and persist PDFs for every paper in the daily result set.
      await uploadPdfs(normalized);
      analyzed = await analyzeTopPapers(normalized, lang);
      await saveDailyPapers(targetDate, run.id, analyzed);
    }

    const response: PapersResponse = {
      date: targetDate,
      papers: analyzed,
      total: analyzed.length,
    };

    if (isObjectStorageConfigured()) {
      await putJsonObject(`daily/${targetDate}/crawl-result.json`, response);
    }
    await cachePapers(`${targetDate}_day_${lang}`, response);

    await finishCrawlRun(targetDate, "success", {
      totalFound: analyzed.length,
      totalSaved: analyzed.length,
    });

    return {
      date: targetDate,
      status: "success",
      reused: false,
      total: analyzed.length,
      papers: analyzed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await finishCrawlRun(targetDate, "failed", { errorMessage: message });
    return {
      date: targetDate,
      status: "failed",
      reused: false,
      total: 0,
      papers: [],
      message,
    };
  }
}
