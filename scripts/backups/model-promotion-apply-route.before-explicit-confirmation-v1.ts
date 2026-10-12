import {
  NextResponse,
} from "next/server";

import {
  applyManualPaperPromotion,
  preflightManualPaperPromotion,
} from "@/lib/models/model-promotion-manual-apply";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface ManualPromotionRequest {
  modelId?: unknown;
  toStage?: unknown;
  manualApprovalConfirmed?: unknown;
  actor?: unknown;
  reason?: unknown;
  dryRun?: unknown;
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
        )) as
        ManualPromotionRequest;

    const modelId =
      String(
        body.modelId ??
        "",
      )
        .trim();

    const toStage =
      String(
        body.toStage ??
        "",
      )
        .trim();

    const actor =
      String(
        body.actor ??
        "",
      )
        .trim();

    const reason =
      String(
        body.reason ??
        "",
      )
        .trim();

    const manualApprovalConfirmed =
      body
        .manualApprovalConfirmed ===
      true;

    if (
      !modelId ||
      toStage !==
        "PAPER" ||
      !actor ||
      !reason
    ) {
      return NextResponse.json(
        {
          ok:
            false,
          message:
            "MODEL_PROMOTION_MANUAL_APPLY_INVALID_REQUEST",
        },
        {
          status:
            400,
        },
      );
    }

    const input = {
      modelId,
      toStage:
        "PAPER" as const,
      manualApprovalConfirmed,
      actor,
      reason,
    };

    if (
      body.dryRun ===
      true
    ) {
      const preflight =
        await preflightManualPaperPromotion(
          input,
        );

      return NextResponse.json({
        ok:
          true,
        dryRun:
          true,
        preflight,
      });
    }

    if (
      !manualApprovalConfirmed
    ) {
      return NextResponse.json(
        {
          ok:
            false,
          message:
            "MODEL_PROMOTION_MANUAL_APPROVAL_REQUIRED",
        },
        {
          status:
            409,
        },
      );
    }

    const result =
      await applyManualPaperPromotion(
        input,
      );

    return NextResponse.json({
      ok:
        true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return NextResponse.json(
      {
        ok:
          false,
        message,
      },
      {
        status:
          message.includes(
            "BLOCKED"
          ) ||
          message.includes(
            "FEATURE_DISABLED"
          )
            ? 409
            : 500,
      },
    );
  }
}
