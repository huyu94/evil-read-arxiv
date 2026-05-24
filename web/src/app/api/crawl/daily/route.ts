import { NextRequest, NextResponse } from "next/server";
import { runDailyCrawlWorkflow } from "@/lib/server/crawl-workflow";
import { getCrawlRun, getDailyPapersFromDb } from "@/lib/server/paper-repository";

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date") || todayShanghai();
  const run = await getCrawlRun(date).catch(() => null);
  const daily = await getDailyPapersFromDb(date).catch(() => null);

  return NextResponse.json({
    date,
    status: run?.status || (daily ? "success" : "idle"),
    total: daily?.total || run?.total_saved || 0,
    run,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const date = typeof body.date === "string" ? body.date : todayShanghai();
  const force = Boolean(body.force);
  const triggerType = body.triggerType === "cron" ? "cron" : "manual";

  const result = await runDailyCrawlWorkflow({ date, force, triggerType });
  const status = result.status === "failed" ? 500 : 200;
  return NextResponse.json(result, { status });
}
