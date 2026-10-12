import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase";
import { analyzeEntryThreshold } from "@/lib/trading/analyze-entry-threshold";
import { getActiveEntryThreshold } from "@/lib/trading/get-active-entry-threshold";
import { getEntryThresholdGovernance } from "@/lib/trading/get-entry-threshold-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GovernanceAction =
  | "ANALYZE"
  | "APPLY"
  | "REJECT";

interface GovernanceRequest {
  action?: unknown;
  recommendationId?: unknown;
  approvedBy?: unknown;
  secret?: unknown;
}

function isLocalRequest(
  request: Request,
): boolean {
  try {
    const hostname =
      new URL(
        request.url,
      ).hostname.toLowerCase();

    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

function getActor(
  value: unknown,
): string {
  if (
    typeof value !== "string"
  ) {
    return "DASHBOARD";
  }

  const trimmed =
    value.trim();

  return trimmed
    ? trimmed.slice(0, 100)
    : "DASHBOARD";
}

export async function GET() {
  try {
    const data =
      await getEntryThresholdGovernance();

    return NextResponse.json({
      ok: true,
      data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "기준점수 관리 조회 실패",
      },
      {
        status: 500,
      },
    );
  }
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as GovernanceRequest;

    const expectedSecret =
      process.env
        .TRADING_AUTOMATION_SECRET
        ?.trim() ?? "";

    const providedSecret =
      request.headers
        .get(
          "x-automation-secret",
        )
        ?.trim() ??
      String(
        body.secret ?? "",
      ).trim();

    if (
      process.env.NODE_ENV ===
        "production" &&
      !isLocalRequest(request) &&
      (
        !expectedSecret ||
        providedSecret !==
          expectedSecret
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "기준점수 관리 권한이 없습니다.",
        },
        {
          status: 401,
        },
      );
    }

    const action =
      typeof body.action ===
        "string"
        ? (
            body.action as
              GovernanceAction
          )
        : null;

    if (
      !action ||
      ![
        "ANALYZE",
        "APPLY",
        "REJECT",
      ].includes(action)
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "지원하지 않는 기준점수 명령입니다.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      action === "ANALYZE"
    ) {
      const activeThreshold =
        await getActiveEntryThreshold();

      const result =
        await analyzeEntryThreshold({
          currentThreshold:
            activeThreshold,

          lookbackDays: 90,
          minimumSamples: 30,
          minimumClassSamples: 5,

          maximumThresholdChange:
            0.05,

          minimumImprovement:
            0.015,
        });

      return NextResponse.json({
        ok: true,
        action,
        result,
      });
    }

    const recommendationId =
      typeof body.recommendationId ===
        "string"
        ? body.recommendationId.trim()
        : "";

    if (!recommendationId) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "추천 결과 ID가 필요합니다.",
        },
        {
          status: 400,
        },
      );
    }

    const actor =
      getActor(
        body.approvedBy,
      );

    const supabase =
      createSupabaseServerClient();

    if (
      action === "APPLY"
    ) {
      const {
        data,
        error,
      } = await supabase.rpc(
        "apply_entry_threshold_recommendation",
        {
          p_recommendation_id:
            recommendationId,

          p_approved_by:
            actor,
        },
      );

      if (error) {
        throw new Error(
          `추천 기준점수 적용 실패: ${error.message}`,
        );
      }

      return NextResponse.json({
        ok: true,
        action,
        result: data,
      });
    }

    const {
      data,
      error,
    } = await supabase.rpc(
      "reject_entry_threshold_recommendation",
      {
        p_recommendation_id:
          recommendationId,

        p_rejected_by:
          actor,
      },
    );

    if (error) {
      throw new Error(
        `추천 기준점수 거절 실패: ${error.message}`,
      );
    }

    return NextResponse.json({
      ok: true,
      action,
      result: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "기준점수 관리 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}