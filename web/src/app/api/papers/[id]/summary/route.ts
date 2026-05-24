import { NextRequest, NextResponse } from "next/server";
import { createAnthropicClientWithSettings } from "@/lib/anthropic";
import {
  cacheSummary,
  getCachedSummary,
  getResearchConfig,
} from "@/lib/data";
import { type Language, prompts } from "@/lib/i18n";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/papers/[id]/summary">
) {
  const { id } = await ctx.params;
  const arxivId = decodeURIComponent(id);

  try {
    const config = await getResearchConfig();
    const lang: Language = config.language === "en" ? "en" : "zh";
    const cacheId = `${arxivId}_${lang}`;
    const cached = await getCachedSummary(cacheId);
    if (cached) {
      return NextResponse.json({ summary: cached });
    }

    const body = await request.json().catch(() => ({}));
    const title = typeof body.title === "string" ? body.title : "";
    const abstract = typeof body.abstract === "string" ? body.abstract : "";

    if (!abstract) {
      return NextResponse.json(
        { error: "Paper abstract is required" },
        { status: 400 }
      );
    }

    const { client, model } = await createAnthropicClientWithSettings();
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: prompts.summary[lang](title, abstract),
        },
      ],
    });

    const summary =
      response.content[0].type === "text" ? response.content[0].text.trim() : "";

    if (!summary) {
      return NextResponse.json(
        { error: "Summary generation returned empty content" },
        { status: 502 }
      );
    }

    await cacheSummary(cacheId, summary);
    return NextResponse.json({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Summary failed: ${message}` },
      { status: 500 }
    );
  }
}
