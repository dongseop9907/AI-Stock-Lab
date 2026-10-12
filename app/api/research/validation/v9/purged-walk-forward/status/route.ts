import {
  NextResponse,
} from "next/server";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET(
  request:
    Request,
) {
  try {
    const url =
      new URL(
        request.url,
      );

    const planId =
      url
        .searchParams
        .get(
          "planId",
        );

    const supabase =
      createSupabaseServerClient();

    let query =
      supabase
        .from(
          "alpha_validation_plans",
        )
        .select(`
          id,
          protocol_name,
          protocol_version,
          universe_code,
          calendar_index_code,
          requested_start_date,
          requested_end_date,
          training_window_days,
          purge_days,
          test_window_days,
          embargo_days,
          label_horizon_days,
          minimum_pit_members,
          status,
          fold_count,
          pit_ready_fold_count,
          pit_blocked_fold_count,
          config,
          safety,
          created_at,
          finished_at,
          error_message,
          production_applied
        `);

    if (
      planId
    ) {
      query =
        query.eq(
          "id",
          planId,
        );
    }

    const {
      data: plan,
      error,
    } =
      await query
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        )
        .limit(1)
        .maybeSingle();

    if (
      error
    ) {
      throw new Error(
        error.message,
      );
    }

    let folds:
      unknown[] = [];

    if (
      plan?.id
    ) {
      const {
        data,
        error: foldError,
      } =
        await supabase
          .from(
            "alpha_validation_folds",
          )
          .select(`
            fold_index,
            train_start_date,
            train_end_date,
            purge_start_date,
            purge_end_date,
            test_start_date,
            test_end_date,
            embargo_start_date,
            embargo_end_date,
            pit_member_count,
            pit_complete_member_count,
            pit_coverage_ready,
            pit_coverage_status
          `)
          .eq(
            "plan_id",
            plan.id,
          )
          .order(
            "fold_index",
            {
              ascending:
                true,
            },
          );

      if (
        foldError
      ) {
        throw new Error(
          foldError.message,
        );
      }

      folds =
        data ??
        [];
    }

    return NextResponse.json({
      ok:
        true,

      result: {
        version:
          "PURGED_EMBARGO_VALIDATION_STATUS_V9_2",

        plan:
          plan ??
          null,

        folds,

        productionApplied:
          false,
      },
    });
  } catch (
    error
  ) {
    return NextResponse.json(
      {
        ok:
          false,

        message:
          error instanceof Error
            ? error.message
            : "v9.2 validation status failed.",
      },
      {
        status:
          500,
      },
    );
  }
}
