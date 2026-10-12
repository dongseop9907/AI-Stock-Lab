import { NextResponse } from "next/server";
import { getInventoryRun } from "@/lib/market/opendart-source-service-v9-7-1";
import { authorizeInventory, inventoryError } from "@/lib/market/opendart-source-http-v9-7-1";
import { uuid } from "@/lib/market/opendart-source-core-v9-7-1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const denied = authorizeInventory(request); if (denied) return denied;
  try {
    const run = await getInventoryRun(uuid(new URL(request.url).searchParams.get("runId")));
    return NextResponse.json({ ok: true, run, eventImportComplete: false, expectedV97Status: "BLOCKED_SOURCE_COVERAGE" });
  } catch (error) { return inventoryError(error); }
}
