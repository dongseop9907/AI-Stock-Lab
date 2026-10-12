import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResetPaperAccountRequest {
  confirmation?: unknown;
  accountName?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(() => ({}))) as ResetPaperAccountRequest;

    const confirmation = String(
      body.confirmation ?? "",
    );

    const accountName =
      String(
        body.accountName ??
          "default-paper",
      ).trim() || "default-paper";

    if (
      confirmation !==
      "RESET_PAPER_ACCOUNT"
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "모의계좌 초기화 확인 문구가 올바르지 않습니다.",
        },
        {
          status: 400,
        },
      );
    }

    const supabase =
      createSupabaseServerClient();

    const {
      data,
      error,
    } = await supabase.rpc(
      "reset_paper_trading_state",
      {
        p_confirmation:
          confirmation,

        p_account_name:
          accountName,
      },
    );

    if (error) {
      throw new Error(
        `모의계좌 초기화 실패: ${error.message}`,
      );
    }

    return NextResponse.json({
      ok: true,
      result: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "모의계좌 초기화 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}