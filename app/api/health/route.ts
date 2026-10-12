import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = createSupabaseServerClient();

    const { count, error } = await supabase
      .from("stocks")
      .select("*", {
        count: "exact",
        head: true,
      });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      service: "ai-stock-lab",
      database: "connected",
      stockCount: count ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "disconnected",
        message:
          error instanceof Error
            ? error.message
            : "Unknown database error",
      },
      { status: 500 },
    );
  }
}