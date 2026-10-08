import { createSupabaseServerClient } from "@/lib/supabase";
import { addDays, date, fetchPage, uuid, type Cursor } from "./opendart-source-core-v9-7-1";

export type InventoryRun = Cursor & {
  id: string; start_date: string; end_date: string; status: "RUNNING" | "INVENTORY_COMPLETE";
  stored_pages: number; disclosure_count: number; candidate_count: number;
  source_coverage_window_id: string | null;
};
export async function getInventoryRun(id: string): Promise<InventoryRun> {
  const { data, error } = await createSupabaseServerClient().from("corporate_action_source_inventory_runs")
    .select("*").eq("id", uuid(id)).single();
  if (error || !data) throw new Error("INVENTORY_RUN_LOOKUP_FAILED");
  return data as InventoryRun;
}
export async function createInventoryRun(input: Record<string, unknown>) {
  // A client-generated ID is persisted before the HTTP call, making creation retry-safe.
  const id = uuid(input.runId), start = date(input.startDate ?? "2023-01-02"), end = date(input.endDate ?? "2026-07-31");
  const koreaToday = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  if (start > end || end >= koreaToday) throw new Error("INVALID_DATE_RANGE_USE_CLOSED_HISTORICAL_DATES");
  const db = createSupabaseServerClient();
  const { error } = await db.from("corporate_action_source_inventory_runs").upsert({
    id, start_date: start, end_date: end, chunk_start: start, chunk_end: [addDays(start, 29), end].sort()[0],
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error("INVENTORY_RUN_CREATE_FAILED_CHECK_MIGRATION_061");
  const run = await getInventoryRun(id);
  if (run.start_date !== start || run.end_date !== end) throw new Error("RUN_ID_CONFIG_MISMATCH");
  return run;
}
function dartKey() {
  for (const name of ["OPENDART_API_KEY", "OPEN_DART_API_KEY", "DART_API_KEY", "DART_KEY", "OPEN_DART_KEY"]) {
    const key = process.env[name]?.trim(); if (key) return key;
  }
  throw new Error("DART_API_KEY_NOT_FOUND");
}
export async function processInventoryPage(id: string) {
  const run = await getInventoryRun(id);
  if (run.status === "INVENTORY_COMPLETE") return { staleRequest: false, run };
  const page = await fetchPage(run, dartKey());
  const { data, error } = await createSupabaseServerClient().rpc("append_corporate_action_source_page_v9_7_1", {
    p_run_id: run.id, p_chunk_start: run.chunk_start, p_corp_cls: run.corp_cls, p_page_no: run.next_page,
    p_total_count: page.totalCount, p_total_pages: page.totalPages, p_response_sha256: page.responseHash,
    p_raw_response: page.raw, p_candidates: page.candidates,
  });
  if (error) {
    if (error.message.includes("SOURCE_TOTAL_CHANGED")) throw new Error("SOURCE_TOTAL_CHANGED_START_NEW_RUN");
    if (error.message.includes("DUPLICATE_RECEIPT")) throw new Error("DUPLICATE_RECEIPT_START_NEW_RUN");
    throw new Error("INVENTORY_PAGE_COMMIT_FAILED_CURSOR_NOT_ADVANCED");
  }
  return data as { staleRequest: boolean; run: InventoryRun };
}
