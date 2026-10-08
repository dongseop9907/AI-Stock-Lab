import {
  PAPER_BUY_RESERVATION_EXPIRY_INTERVAL,
} from "@/lib/trading/automation-cycle-contract";

type MaintenancePhase =
  | "PRE_CYCLE"
  | "POST_EXECUTION";

type JsonRecord =
  Record<string, unknown>;

export interface RunCommittedRiskMaintenanceInput {
  phase: MaintenancePhase;
  runExpiry?: boolean;
  staleAfterInterval?: string;
  expireLimit?: number;
  reconcileLimit?: number;
}

export interface RunCommittedRiskMaintenanceResult {
  ok: true;
  phase: MaintenancePhase;
  expiry: unknown | null;
  reconciliation: unknown;
}

function requiredEnv(
  name: string,
  value: string | undefined,
) {
  const trimmed =
    value?.trim();

  if (!trimmed) {
    throw new Error(
      `${name}_REQUIRED`,
    );
  }

  return trimmed;
}

async function callServiceRoleRpc(
  functionName: string,
  body: JsonRecord,
) {
  const supabaseUrl =
    requiredEnv(
      "NEXT_PUBLIC_SUPABASE_URL_OR_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
        process.env.SUPABASE_URL,
    );

  const serviceRoleKey =
    requiredEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

  const response =
    await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${functionName}`,
      {
        method: "POST",

        headers: {
          apikey:
            serviceRoleKey,

          Authorization:
            `Bearer ${serviceRoleKey}`,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            body,
          ),

        cache:
          "no-store",
      },
    );

  const responseText =
    await response.text();

  let payload: unknown =
    responseText;

  if (responseText.trim()) {
    try {
      payload =
        JSON.parse(
          responseText,
        );
    } catch {
      payload =
        responseText;
    }
  } else {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      [
        "COMMITTED_RISK_MAINTENANCE_RPC_FAILED",
        functionName,
        String(response.status),
        typeof payload === "string"
          ? payload
          : JSON.stringify(payload),
      ].join(":"),
    );
  }

  return payload;
}

export async function runCommittedRiskMaintenance(
  input: RunCommittedRiskMaintenanceInput,
): Promise<RunCommittedRiskMaintenanceResult> {
  const runExpiry =
    input.runExpiry ??
    input.phase === "PRE_CYCLE";

  const staleAfterInterval =
    input.staleAfterInterval ??
    PAPER_BUY_RESERVATION_EXPIRY_INTERVAL;

  const expireLimit =
    input.expireLimit ??
    100;

  const reconcileLimit =
    input.reconcileLimit ??
    500;

  /*
   * Reconcile before expiry so stale terminal leftovers cannot consume
   * committed-risk capacity while we evaluate active reservations.
   */
  const preReconciliation =
    await callServiceRoleRpc(
      "reconcile_paper_buy_reserved_risk_v3",
      {
        p_limit:
          reconcileLimit,
      },
    );

  let expiry: unknown | null =
    null;

  if (runExpiry) {
    expiry =
      await callServiceRoleRpc(
        "expire_stale_paper_buy_reservations_v3",
        {
          p_stale_after:
            staleAfterInterval,

          p_limit:
            expireLimit,
        },
      );
  }

  /*
   * Expiry transitions rows to EXPIRED and the terminal trigger should
   * release risk in the same DB transaction. A second reconciliation pass
   * catches any legacy/abnormal terminal leftovers and is intentionally
   * decrease-only.
   */
  const postReconciliation =
    runExpiry
      ? await callServiceRoleRpc(
          "reconcile_paper_buy_reserved_risk_v3",
          {
            p_limit:
              reconcileLimit,
          },
        )
      : preReconciliation;

  return {
    ok: true,
    phase:
      input.phase,

    expiry,

    reconciliation:
      postReconciliation,
  };
}
