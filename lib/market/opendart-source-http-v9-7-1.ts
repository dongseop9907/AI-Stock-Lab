import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export function authorizeInventory(request: Request): Response | null {
  const expected = process.env.CORPORATE_ACTION_IMPORT_TOKEN;
  if (!expected || expected.length < 32) return NextResponse.json({ ok: false, message: "SET_CORPORATE_ACTION_IMPORT_TOKEN_MIN_32_CHARS" }, { status: 503 });
  const actual = request.headers.get("authorization") ?? "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(digest(actual), digest(`Bearer ${expected}`))) return NextResponse.json({ ok: false, message: "UNAUTHORIZED" }, { status: 401 });
  return null;
}
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 4096) throw new Error("INVALID_REQUEST_SIZE");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_REQUEST_BODY");
  return value as Record<string, unknown>;
}
export function inventoryError(error: unknown) {
  const raw = error instanceof Error ? error.message : "INVENTORY_REQUEST_FAILED";
  // Only our constant error codes go to the caller; no URLs, keys or DB payloads.
  const message = /^[A-Z0-9_]+$/.test(raw) ? raw : "INVENTORY_REQUEST_FAILED";
  return NextResponse.json({ ok: false, message }, { status: message.startsWith("INVALID_") ? 400 : 502 });
}
