import { NextResponse } from "next/server";
import { getDailyPaperDigests } from "@/lib/data";

export async function GET() {
  try {
    const digests = await getDailyPaperDigests();
    return NextResponse.json({ digests });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to load daily digests: ${message}` },
      { status: 500 }
    );
  }
}
