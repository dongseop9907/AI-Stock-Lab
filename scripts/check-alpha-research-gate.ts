import { createSupabaseServerClient } from "../lib/supabase";
import {
  evaluateAlphaBacktestResearchGateV95,
} from "../lib/research/evaluate-alpha-backtest-research-gate-v9-5";

async function main() {
  const supabase =
    createSupabaseServerClient();

  const universeCode =
    process.argv[2] ||
    "KRX_ALL_LISTED";

  const {
    data: plan,
    error: planError,
  } =
    await supabase
      .from("alpha_validation_plans")
      .select(`
        id,
        universe_code,
        requested_start_date,
        requested_end_date,
        status,
        fold_count,
        pit_ready_fold_count,
        pit_blocked_fold_count,
        created_at
      `)
      .eq(
        "universe_code",
        universeCode,
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    planError
  ) {
    throw new Error(
      `LATEST_ALPHA_VALIDATION_PLAN_QUERY_FAILED: ${planError.message}`,
    );
  }

  if (
    !plan
  ) {
    throw new Error(
      `NO_ALPHA_VALIDATION_PLAN:${universeCode}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        phase:
          "LATEST_ALPHA_VALIDATION_PLAN",
        plan,
      },
      null,
      2,
    ),
  );

  const result =
    await evaluateAlphaBacktestResearchGateV95(
      {
        universeCode,
        startDate:
          String(
            plan.requested_start_date,
          ),
        endDate:
          String(
            plan.requested_end_date,
          ),
      },
    );

  console.log(
    "\n" +
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  if (
    result.status !==
    "READY"
  ) {
    process.exitCode = 2;
  }
}

main().catch(
  (
    error,
  ) => {
    console.error(
      error instanceof Error
        ? error.stack
        : error,
    );

    process.exitCode = 1;
  },
);
