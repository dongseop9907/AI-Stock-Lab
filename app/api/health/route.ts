import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, service: "ai-stock-lab", timestamp: new Date().toISOString() });
}
