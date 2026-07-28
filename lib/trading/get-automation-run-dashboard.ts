import { createSupabaseServerClient } from "@/lib/supabase";

export type AutomationRunStatus =
  | "RUNNING"
  | "SUCCESS"
  | "PARTIAL_FAILURE"
  | "FAILED";

export interface AutomationStepDashboard {
  name: string;
  ok: boolean;
  statusCode: number;
  error: string | null;
}

export interface AutomationRunDashboardRow {
  id: string;

  triggerType:
    | "MANUAL"
    | "SCHEDULED";

  status: AutomationRunStatus;

  startedAt: string;
  finishedAt: string | null;

  includeMarketSync: boolean;
  autoOrder: boolean;
  maxOrders: number;

  requestedSteps: number;
  completedSteps: number;
  successCount: number;
  failureCount: number;

  stoppedEarly: boolean;

  steps: AutomationStepDashboard[];
  errorMessage: string | null;
}

interface AutomationRunRecord {
  id: string;
  trigger_type:
    | "MANUAL"
    | "SCHEDULED";

  status: AutomationRunStatus;

  started_at: string;
  finished_at: string | null;

  steps: unknown;
  summary: unknown;

  error_message: string | null;
}

function asRecord(
  value: unknown,
): Record<string, unknown> {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as Record<
      string,
      unknown
    >;
  }

  return {};
}

function toNumber(
  value: unknown,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function toBoolean(
  value: unknown,
): boolean {
  return value === true;
}

function parseSteps(
  value: unknown,
): AutomationStepDashboard[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    const record =
      asRecord(item);

    return {
      name:
        typeof record.name === "string"
          ? record.name
          : "알 수 없는 단계",

      ok: record.ok === true,

      statusCode:
        toNumber(
          record.statusCode,
        ),

      error:
        typeof record.error === "string"
          ? record.error
          : null,
    };
  });
}

export async function getAutomationRunDashboard(): Promise<
  AutomationRunDashboardRow[]
> {
  const supabase =
    createSupabaseServerClient();

  const { data, error } =
    await supabase
      .from(
        "trading_automation_runs",
      )
      .select(`
        id,
        trigger_type,
        status,
        started_at,
        finished_at,
        steps,
        summary,
        error_message
      `)
      .order("started_at", {
        ascending: false,
      })
      .limit(30);

  if (error) {
    throw new Error(
      `자동 운영 기록 조회 실패: ${error.message}`,
    );
  }

  return (
    (data ?? []) as AutomationRunRecord[]
  ).map((run) => {
    const summary =
      asRecord(run.summary);

    return {
      id: run.id,

      triggerType:
        run.trigger_type,

      status:
        run.status,

      startedAt:
        run.started_at,

      finishedAt:
        run.finished_at,

      includeMarketSync:
        toBoolean(
          summary.includeMarketSync,
        ),

      autoOrder:
        toBoolean(
          summary.autoOrder,
        ),

      maxOrders:
        toNumber(
          summary.maxOrders,
        ),

      requestedSteps:
        toNumber(
          summary.requestedSteps,
        ),

      completedSteps:
        toNumber(
          summary.completedSteps,
        ),

      successCount:
        toNumber(
          summary.successCount,
        ),

      failureCount:
        toNumber(
          summary.failureCount,
        ),

      stoppedEarly:
        toBoolean(
          summary.stoppedEarly,
        ),

      steps:
        parseSteps(run.steps),

      errorMessage:
        run.error_message,
    };
  });
}