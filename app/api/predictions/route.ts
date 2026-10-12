import { NextResponse } from "next/server";
import { demoPredictions } from "@/lib/demo-data";

export async function GET() {
  return NextResponse.json({ data: demoPredictions, source: "demo" });
}
