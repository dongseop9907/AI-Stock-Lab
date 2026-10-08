import { NextResponse } from "next/server";
import { processInventoryPage } from "@/lib/market/opendart-source-service-v9-7-1";
import { authorizeInventory, inventoryError, jsonBody } from "@/lib/market/opendart-source-http-v9-7-1";
import { uuid } from "@/lib/market/opendart-source-core-v9-7-1";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = authorizeInventory(request); if (denied) return denied;
  try {
    const body = await jsonBody(request);
    const result = await processInventoryPage(uuid(body.runId));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) { return inventoryError(error); }
}
