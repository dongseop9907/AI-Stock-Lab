import { NextResponse } from "next/server";
import { createInventoryRun } from "@/lib/market/opendart-source-service-v9-7-1";
import { authorizeInventory, inventoryError, jsonBody } from "@/lib/market/opendart-source-http-v9-7-1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  const denied = authorizeInventory(request); if (denied) return denied;
  try {
    const body = await jsonBody(request);
    const run = await createInventoryRun(body);
    return NextResponse.json({ ok: true, run });
  } catch (error) { return inventoryError(error); }
}
