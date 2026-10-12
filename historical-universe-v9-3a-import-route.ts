import { NextResponse } from "next/server";
import { ingestHistoricalUniverseSnapshotV93A } from "@/lib/market/ingest-historical-universe-snapshot-v9-3a";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request) {
  try {
    const body=await request.json();
    const result=await ingestHistoricalUniverseSnapshotV93A(body);
    return NextResponse.json({ok:true,result});
  } catch (error) {
    return NextResponse.json(
      {ok:false,message:error instanceof Error ? error.message : "v9.3A import failed."},
      {status:500},
    );
  }
}
